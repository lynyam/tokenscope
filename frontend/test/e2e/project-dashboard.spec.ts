import { expect, test, type Page } from "@playwright/test";
import {
  addMember, apiGet, createOrganization, createProject, signedInContext, signInPage, signUp, trackRequests,
  type TestUser,
} from "./helpers";
import { createApiKey, fixtureBodies, ingest, ingestAll, requireCatalogue, type TraceBody } from "./trace-helpers";

// Real frontend + backend (with the realtime gateway) + PostgreSQL.
// Needs the synthetic price catalogue (docs/LOCAL_DEVELOPMENT.md, "Explicit price catalogue loading")
// and the realtime origin of the frontend in REALTIME_ALLOWED_ORIGINS.
//
// The golden fixtures are dated 2026-10-01: they are read through an explicit custom UTC period.
// Live scenarios ingest traces dated a few hours ago, which are inside the default "last 7 days".

test.describe.configure({ mode: "serial" });

const API = "/api/v1";
const HOUR = 3_600_000;
let owner: TestUser;
let member: TestUser;
let organizationId: string;
let golden: { projectId: string };
let live: { projectId: string; key: string };

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(240_000);
  const request = await playwright.request.newContext({ baseURL, ignoreHTTPSErrors: true });
  owner = await signUp(request, "dashboard-owner");
  member = await signUp(request, "dashboard-member");
  await requireCatalogue(request, owner);
  organizationId = await createOrganization(request, owner);
  await addMember(request, owner, organizationId, member, "MEMBER");

  const goldenProject = await createProject(request, owner, organizationId, "E2E Dashboard Golden");
  const goldenKey = await createApiKey(request, owner, organizationId, goldenProject);
  await ingestAll(request, goldenKey, fixtureBodies("traces-golden.json"));
  golden = { projectId: goldenProject };

  const liveProject = await createProject(request, owner, organizationId, "E2E Dashboard Live");
  live = { projectId: liveProject, key: await createApiKey(request, owner, organizationId, liveProject) };
  await request.dispose();
});

const dashboardPath = (projectId: string) => `/organizations/${organizationId}/projects/${projectId}/dashboard`;

async function openDashboard(page: Page, user: TestUser, projectId: string) {
  await signInPage(page, user);
  await page.goto(dashboardPath(projectId));
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

const metric = (page: Page, label: string) =>
  page.getByTestId("metric").filter({ has: page.getByText(label, { exact: true }) });
const realtime = (page: Page) => page.getByTestId("realtime-state");

async function applyPeriod(page: Page, from: string, to: string) {
  await page.getByLabel("From (UTC)").fill(from);
  await page.getByLabel("To (UTC)").fill(to);
  await page.getByRole("button", { name: "Apply period" }).click();
}

/** A trace dated a few hours ago: inside the default period of a dashboard opened just now. */
function recentTrace(label: string, hoursAgo: number): TraceBody {
  return {
    ...fixtureBodies("traces-golden.json")[0],
    externalId: `dash-${label}-${Date.now()}`,
    occurredAt: new Date(Date.now() - hoursAgo * HOUR).toISOString(),
  };
}

test("shows the golden figures, charts and exact values for an explicit UTC period", async ({ page }) => {
  await openDashboard(page, owner, golden.projectId);
  // The default period (last 7 days) holds no golden trace: an honest empty state, not zeros.
  await expect(page.getByText("No traces match this period and these filters.")).toBeVisible();
  await expect(metric(page, "Average latency")).toContainText("No observations");

  await applyPeriod(page, "2026-10-01T00:00", "2026-10-02T00:00");
  await expect(metric(page, "Estimated cost")).toContainText("$0.01535");
  await expect(metric(page, "Traces")).toContainText("6");
  await expect(metric(page, "Input tokens")).toContainText("6,000");
  await expect(metric(page, "Output tokens")).toContainText("1,200");
  await expect(metric(page, "Average latency")).toContainText("1.83 s");
  await expect(metric(page, "Error rate")).toContainText("33.33 %");

  for (const title of ["Cost over time", "Cost by provider and model", "Input and output tokens"]) {
    await expect(page.getByRole("region", { name: title })).toBeVisible();
  }
  // The keyboard-accessible table keeps the exact decimal string.
  const panel = page.getByRole("region", { name: "Cost by provider and model" });
  await panel.getByRole("button", { name: "Show data table" }).click();
  await expect(page.getByRole("region", { name: /exact values/ }).first()).toContainText("0.008200000000");
});

test("filters narrow the figures and Reset returns to the default selection", async ({ page }) => {
  await openDashboard(page, owner, golden.projectId);
  await applyPeriod(page, "2026-10-01T00:00", "2026-10-02T00:00");
  await expect(metric(page, "Traces")).toContainText("6");

  await page.getByLabel("Provider", { exact: true }).selectOption("fixture-a");
  await expect(metric(page, "Traces")).toContainText("3");
  await expect(metric(page, "Estimated cost")).toContainText("$0.00715");

  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByLabel("Provider", { exact: true })).toHaveValue("");
  await expect(page.getByText("No traces match this period and these filters.")).toBeVisible();
});

test("an invalid period is explained, sends no request and keeps the applied figures", async ({ page }) => {
  await openDashboard(page, owner, golden.projectId);
  await applyPeriod(page, "2026-10-01T00:00", "2026-10-02T00:00");
  await expect(metric(page, "Traces")).toContainText("6");

  const requests = trackRequests(page, "GET", /\/analytics$/);
  await applyPeriod(page, "2026-10-02T00:00", "2026-10-01T00:00");
  await expect(page.getByRole("alert")).toContainText("The end of the period must be after its start.");
  await applyPeriod(page, "2026-01-01T00:00", "2026-10-01T00:00");
  await expect(page.getByRole("alert")).toContainText("90 days");
  expect(requests).toHaveLength(0);
  await expect(metric(page, "Traces")).toContainText("6");
});

test("two browsers see a new trace without reloading", async ({ browser, baseURL, request }) => {
  const ownerContext = await signedInContext(browser, baseURL, owner);
  const memberContext = await signedInContext(browser, baseURL, member);
  try {
    const pages = [await ownerContext.newPage(), await memberContext.newPage()];
    await Promise.all(pages.map(page => page.goto(dashboardPath(live.projectId))));
    for (const page of pages) {
      await expect(realtime(page)).toHaveText("Live", { timeout: 20_000 });
      await expect(page.getByText("No traces match this period and these filters.")).toBeVisible();
    }

    await ingest(request, live.key, recentTrace("live", 2));
    for (const page of pages) {
      await expect(metric(page, "Traces")).toContainText("1", { timeout: 20_000 });
      await expect(realtime(page)).toHaveText("Live");
    }
  } finally {
    await ownerContext.close();
    await memberContext.close();
  }
});

test("recovers after the browser goes offline and back", async ({ browser, baseURL, request }) => {
  const context = await signedInContext(browser, baseURL, owner);
  try {
    const page = await context.newPage();
    await page.goto(dashboardPath(live.projectId));
    await expect(realtime(page)).toHaveText("Live", { timeout: 20_000 });
    await expect(metric(page, "Traces")).toContainText("1");

    await context.setOffline(true);
    await expect(realtime(page)).toHaveText("Offline");
    // The last confirmed figures stay on screen while offline.
    await expect(metric(page, "Traces")).toContainText("1");

    // A trace arrives while the browser is away (no replay: the page must read again).
    await ingest(request, live.key, recentTrace("offline", 3));
    await context.setOffline(false);

    await expect(metric(page, "Traces")).toContainText("2", { timeout: 30_000 });
    await expect(realtime(page)).toHaveText("Live", { timeout: 40_000 });
  } finally {
    await context.close();
  }
});

test("removing a member makes the project unavailable for them without signing them out", async ({ browser, baseURL, request }) => {
  const context = await signedInContext(browser, baseURL, member);
  try {
    const page = await context.newPage();
    await page.goto(dashboardPath(live.projectId));
    await expect(realtime(page)).toHaveText("Live", { timeout: 20_000 });
    await expect(metric(page, "Traces")).toBeVisible();

    const list = await apiGet(request, owner, `${API}/organizations/${organizationId}/members`);
    expect(list.status()).toBe(200);
    const { memberships } = (await list.json()) as { memberships: { user: { id: string; email: string } }[] };
    const entry = memberships.find(item => item.user.email === member.email);
    expect(entry, "the member is listed").toBeTruthy();
    const removed = await request.delete(`${API}/organizations/${organizationId}/members/${entry!.user.id}`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(removed.status()).toBeLessThan(300);

    await expect(page.getByText("This project is not available.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("metric")).toHaveCount(0); // protected figures are gone
    // Access loss is not a sign-out: the login is still stored.
    expect(await page.evaluate(() => localStorage.getItem("tokenscope.accessToken"))).not.toBeNull();
  } finally {
    await context.close();
  }
});
