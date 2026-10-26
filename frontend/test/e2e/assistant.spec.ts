import { expect, test, type Page, type Route } from "@playwright/test";
import { addMember, createOrganization, createProject, signInPage, signUp, trackRequests, type TestUser } from "./helpers";
import { createApiKey, fixtureBodies, ingestAll, requireCatalogue } from "./trace-helpers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AssistantContext } from "../../src/types/assistant.types";

// Real dashboard/auth/analytics/PostgreSQL; ONLY the assistant response is intercepted.
// No provider request is allowed by these tests. Buffered fixtures do not prove
// progressive delivery: run the separate opt-in live check in docs/DEMO.md.
// Playwright uses CommonJS here; the Vitest reader uses import.meta.url.
const fixtureRoot = resolve(__dirname, "../../../fixtures/evaluation/assistant");
const context = JSON.parse(readFileSync(resolve(fixtureRoot, "context.json"), "utf8")) as AssistantContext;
const requestBody = JSON.parse(readFileSync(resolve(fixtureRoot, "request.json"), "utf8"));
const assistantRoute = "**/api/v1/organizations/*/projects/*/assistant";
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
let owner: TestUser;
let admin: TestUser;
let member: TestUser;
let organizationId: string;
let projectId: string;

function success(text = "The highest estimated cost is fixture-b/demo-large.") {
  return frame("start", {
    requestId: "assistant-browser-fixture", provider: "gemini", model: "fixture-model",
    context: { ...context, project: { ...context.project, id: projectId } },
  }) + frame("delta", { text }) + frame("done", {
    requestId: "assistant-browser-fixture", finishReason: "stop", usage: null,
  });
}
const fulfilSuccess = (route: Route, text?: string) => route.fulfill({
  status: 200, contentType: "text/event-stream", body: success(text),
  headers: { "X-Request-Id": "assistant-browser-fixture", "Cache-Control": "no-store" },
});

// Every test uses its own browser context; the shared project is read-only.
test.beforeAll(async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  try {
    owner = await signUp(request, "assistant-owner");
    await requireCatalogue(request, owner);
    admin = await signUp(request, "assistant-admin");
    member = await signUp(request, "assistant-member");
    organizationId = await createOrganization(request, owner);
    await addMember(request, owner, organizationId, admin, "ADMIN");
    await addMember(request, owner, organizationId, member, "MEMBER");
    projectId = await createProject(request, owner, organizationId, "Assistant browser fixture");
    const key = await createApiKey(request, owner, organizationId, projectId);
    await ingestAll(request, key, fixtureBodies("traces-golden.json"));
  } finally { await request.dispose(); }
});

async function open(page: Page, user: TestUser) {
  await signInPage(page, user);
  const query = new URLSearchParams({ from: requestBody.from, to: requestBody.to });
  await page.goto(`/organizations/${organizationId}/projects/${projectId}?${query}`);
  await expect(page.getByTestId("metric").filter({ has: page.getByText("Traces", { exact: true }) })).toContainText("6");
  await page.getByRole("button", { name: "Ask assistant", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeEnabled();
}

for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
  test(`${role} uses the real dashboard with an intercepted assistant answer`, async ({ page }) => {
    await page.route(assistantRoute, route => fulfilSuccess(route));
    const calls = trackRequests(page, "POST", /\/assistant$/);
    const user = role === "OWNER" ? owner : role === "ADMIN" ? admin : member;
    await open(page, user);
    expect(calls).toHaveLength(0);
    await expect(page.getByLabel("Your question")).toBeFocused();
    await page.getByLabel("Your question").fill("   ");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByLabel("Your question")).toHaveAttribute("aria-invalid", "true");
    expect(calls).toHaveLength(0);
    await page.getByLabel("Your question").fill(requestBody.question);
    const sent = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith("/assistant"));
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    const submission = await sent;
    expect(submission.postDataJSON()).toEqual(requestBody);
    // Do not print credentials in a failed assertion.
    expect(submission.headers().authorization === `Bearer ${user.token}`).toBe(true);
    const panel = page.getByRole("dialog", { name: "Ask assistant" });
    await expect(panel.getByText("Answer complete.", { exact: true }).first()).toBeVisible();
    const facts = page.getByRole("region", { name: "Context used" });
    const disclosure = facts.locator("details").first();
    await expect(disclosure).not.toHaveAttribute("open");
    await facts.getByText("Context used", { exact: true }).click();
    await expect(disclosure).toHaveAttribute("open", "");
    await expect(facts.getByText("$0.01535", { exact: true })).toBeVisible();
    await expect(facts).toContainText("6,000 in · 1,200 out · 7,200 total");
    await expect(facts).toContainText(context.generatedAt);
    expect(calls).toHaveLength(1);
  });
}

test("date drafts and same-scope refresh keep the answer; applied changes clear it", async ({ page }) => {
  await page.route(assistantRoute, route => fulfilSuccess(route));
  const calls = trackRequests(page, "POST", /\/assistant$/);
  await open(page, owner);
  await page.getByLabel("To (UTC)").fill("2026-10-03T00:00"); // not applied
  await page.getByLabel("Your question").fill("Which model costs most?");
  const sent = page.waitForRequest(request => request.url().endsWith("/assistant"));
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  expect((await sent).postDataJSON().to).toBe(requestBody.to);
  await expect(page.getByText("The highest estimated cost is fixture-b/demo-large.")).toBeVisible();
  const refresh = page.getByRole("button", { name: "Refresh", exact: true });
  await refresh.evaluate(element => element.scrollIntoView({ block: "start" }));
  const reloaded = page.waitForResponse(response => response.url().includes("/analytics?") && response.status() === 200);
  await refresh.click();
  await reloaded;
  await expect(page.getByRole("region", { name: "Context used" })).toContainText(context.generatedAt);
  await page.getByRole("button", { name: "Apply period" }).click();
  await expect(page.getByRole("region", { name: "Context used" })).toHaveCount(0);
  await expect(page.getByText("The highest estimated cost is fixture-b/demo-large.")).toHaveCount(0);
  expect(calls).toHaveLength(1);
});

test("a provider failure preserves the question and only an explicit Ask retries", async ({ page }) => {
  let count = 0;
  await page.route(assistantRoute, route => ++count === 1
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({
      statusCode: 503, code: "LLM_PROVIDER_BUSY", message: "Provider busy", requestId: "browser-busy",
    }) }) : fulfilSuccess(route));
  await open(page, owner);
  await page.getByLabel("Your question").fill("Explain the costs");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Request ID: browser-busy")).toBeVisible();
  await expect(page.getByLabel("Your question")).toHaveValue("");
  await expect(page.getByText("Explain the costs", { exact: true })).toBeVisible();
  expect(count).toBe(1);
  await page.getByRole("button", { name: "Reuse question", exact: true }).click();
  await expect(page.getByLabel("Your question")).toHaveValue("Explain the costs");
  expect(count).toBe(1);
  expect(await page.evaluate(() => Boolean(localStorage.getItem("tokenscope.accessToken")))).toBe(true);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("The highest estimated cost is fixture-b/demo-large.")).toBeVisible();
  expect(count).toBe(2);
});

test("Stop before headers discards a late response and allows deliberate retry", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let count = 0;
  await page.route(assistantRoute, async route => {
    if (++count === 1) {
      await gate;
      // Aborting the browser request can close its intercepted route.
      await fulfilSuccess(route, "Late discarded answer").catch(() => {});
    } else await fulfilSuccess(route);
  });
  try {
    await open(page, owner);
    await page.getByLabel("Your question").fill("Explain");
    const sent = page.waitForRequest(request => request.url().endsWith("/assistant"));
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await sent;
    await expect(page.getByLabel("Your question")).toHaveValue("");
    await expect(page.getByText("Explain", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByText("Stopped before an answer was received.", { exact: true }).first()).toBeVisible();
    release();
    await expect(page.getByLabel("Your question")).toHaveValue("");
    await page.getByRole("button", { name: "Reuse question", exact: true }).click();
    expect(count).toBe(1);
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText("The highest estimated cost is fixture-b/demo-large.")).toBeVisible();
    await expect(page.getByText("Late discarded answer")).toHaveCount(0);
    expect(count).toBe(2);
  } finally { release(); }
});

test("project access loss clears the dashboard without logging out", async ({ page }) => {
  await page.route(assistantRoute, route => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({
    statusCode: 404, code: "PROJECT_NOT_FOUND", message: "Not found", requestId: "browser-access",
  }) }));
  await open(page, member);
  await page.getByLabel("Your question").fill("Explain");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Project not found.");
  await expect(page.getByRole("dialog", { name: "Ask assistant" })).toHaveCount(0);
  expect(await page.evaluate(() => Boolean(localStorage.getItem("tokenscope.accessToken")))).toBe(true);
});

test("375px panel wraps plain text and Escape restores launcher focus", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const text = '<img src=x onerror="alert(1)">' + "word".repeat(300);
  await page.route(assistantRoute, route => fulfilSuccess(route, text));
  await open(page, owner);
  await page.getByLabel("Your question").fill("Explain");
  await page.getByLabel("Your question").press("Control+Enter");
  const panel = page.getByRole("dialog", { name: "Ask assistant" });
  await expect(panel.getByText(text, { exact: true })).toBeVisible();
  await expect(panel.locator("img")).toHaveCount(0);
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByLabel("Your question").press("Escape");
  await expect(page.getByRole("button", { name: "Ask assistant", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Your question")).toHaveValue("");
  await expect(page.getByRole("region", { name: "Context used" })).toHaveCount(0);
});

// This test exercises real layout and keyboard activation; assistant data stays intercepted.
test("Expand/Collapse keeps the draft and completed answer without another request", async ({ page }) => {
  await page.route(assistantRoute, route => fulfilSuccess(route));
  const calls = trackRequests(page, "POST", /\/assistant$/);
  await open(page, owner);
  const panel = page.getByRole("dialog", { name: "Ask assistant" });
  const field = page.getByLabel("Your question");
  await field.fill("Explain the costs");
  const expand = panel.getByRole("button", { name: "Expand assistant" });
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toHaveAttribute("data-expanded", "true");
  await expect(field).toHaveValue("Explain the costs");
  expect(calls).toHaveLength(0);

  await field.press("Enter");
  await expect(panel.getByText("Answer complete.", { exact: true }).first()).toBeVisible();
  await expect(field).toHaveValue("");
  await panel.getByRole("button", { name: "Collapse assistant" }).click();
  await expect(panel.getByText("Explain the costs", { exact: true })).toBeVisible();
  await expect(panel.getByText("The highest estimated cost is fixture-b/demo-large.")).toBeVisible();
  await expect(panel.getByRole("region", { name: "Context used" })).toBeVisible();
  expect(calls).toHaveLength(1);
});

test("a panel resized to its minimum still lets the reader reach Stop", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(assistantRoute, async route => {
    await gate;
    await fulfilSuccess(route).catch(() => {}); // Stop can close the route first.
  });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, owner);
    await page.getByLabel("Your question").fill("Explain the costs");
    const sent = page.waitForRequest(request => request.url().endsWith("/assistant"));
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await sent;
    const panel = page.getByRole("dialog", { name: "Ask assistant" });
    const corner = panel.getByTestId("assistant-resize-corner");

    // Let Playwright choose a visible, actionable point on the handle.
    // A point near its top-left corner can be clipped by the rounded panel.
    await corner.hover();

    await page.mouse.down();
    try {
      await page.mouse.move(1250, 770, { steps: 10 });
    } finally {
      await page.mouse.up();
    }
    await expect.poll(() => panel.evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(320);

    // The header + minimum reading area + composer exceed 320px. Wheel scrolling
    // must expose the composer; overflow:hidden would make it unreachable by wheel.
    await panel.locator("header").hover();
    await page.mouse.wheel(0, 1000);
    await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const stop = panel.getByRole("button", { name: "Stop", exact: true });
    const bounds = await panel.boundingBox();
    const stopBounds = await stop.boundingBox();
    expect(stopBounds!.y + stopBounds!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
    await stop.click();
    await expect(page.getByLabel("Your question")).toHaveValue("");
    await expect(panel.getByText("Stopped before an answer was received.", { exact: true }).first()).toBeVisible();
  } finally { release(); }
});


test("keeps two exchanges with formatted answers and collapsed per-answer context", async ({ page }) => {
  let count = 0;
  await page.route(assistantRoute, route => fulfilSuccess(route, ++count === 1
    ? "**First answer** with `demo-fast`.\n\n- Six traces"
    : "**Second answer**"));
  await open(page, owner);
  const panel = page.getByRole("dialog", { name: "Ask assistant" });
  const field = panel.getByLabel("Your question");
  await field.fill("First question");
  await field.press("Enter");
  await expect(panel.locator("strong", { hasText: "First answer" })).toBeVisible();
  await expect(panel.locator("code", { hasText: "demo-fast" })).toBeVisible();
  await expect(panel.getByRole("listitem").filter({ hasText: "Six traces" })).toBeVisible();
  await expect(field).toHaveValue("");
  await field.fill("Second question");
  await field.press("Enter");
  await expect(panel.locator("strong", { hasText: "Second answer" })).toBeVisible();
  const exchanges = panel.getByRole("article", { name: "Assistant exchange" });
  await expect(exchanges).toHaveCount(2);
  await expect(exchanges.nth(0).getByText("First question", { exact: true })).toBeVisible();
  await expect(exchanges.nth(0).locator("strong")).toHaveText("First answer");
  await expect(exchanges.nth(1).getByText("Second question", { exact: true })).toBeVisible();
  await expect(exchanges.nth(1).locator("strong")).toHaveText("Second answer");
  for (const exchange of [exchanges.nth(0), exchanges.nth(1)]) {
    const details = exchange.getByRole("region", { name: "Context used" }).locator("details").first();
    await expect(details).not.toHaveAttribute("open");
  }
  expect(count).toBe(2);
});
