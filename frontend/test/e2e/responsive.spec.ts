import { expect, test, type Locator, type Page } from "@playwright/test";

import { createOrganization, createProject, fixtureBytes, signInPage, signUp, uploadViaApi, type TestUser } from "./helpers";
import {
  createApiKey, fixtureBodies, goldenSearch, ingestAll, requireCatalogue, tracesPath, visibleExternalIds,
} from "./trace-helpers";

// Responsive checks on the real frontend + backend. Every page is opened at the three target viewports.
// Run: E2E_BASE_URL=https://localhost:8443 npx playwright test test/e2e/responsive.spec.ts

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

let owner: TestUser;
let organizationId: string;
let projectId: string;
let traceId: string;
let longOrganizationId: string;
const longOrganizationName = `Responsive-${Date.now()}-${"W".repeat(100)}`.slice(0, 100);
const documentName = "sample-policy.txt";
const goldenBodies = fixtureBodies("traces-golden.json");

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(120_000);
  const request = await playwright.request.newContext({ baseURL });
  try {
    owner = await signUp(request, "responsive-owner");
    await requireCatalogue(request, owner);
    organizationId = await createOrganization(request, owner);
    projectId = await createProject(request, owner, organizationId, "Responsive fixture");
    const key = await createApiKey(request, owner, organizationId, projectId);
    const ingested = await ingestAll(request, key, goldenBodies);
    traceId = [...ingested.values()][0].id;
    await uploadViaApi(request, owner, organizationId, projectId, documentName, fixtureBytes(documentName));
    const longOrganization = await request.post("/api/v1/organizations", {
      headers: { Authorization: `Bearer ${owner.token}` }, data: { name: longOrganizationName },
    });
    expect(longOrganization.status(), "create disposable long-name organization").toBe(201);
    longOrganizationId = (await longOrganization.json()).id;
  } finally {
    await request.dispose();
  }
});

/** The page itself must never scroll sideways: wide content has to scroll inside its own container. */
async function expectNoHorizontalOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const widths = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    view: window.innerWidth,
    main: (document.querySelector("main") as HTMLElement | null)?.scrollWidth ?? 0,
    mainClient: (document.querySelector("main") as HTMLElement | null)?.clientWidth ?? 0,
  }));
  expect(widths.page, "document is wider than the viewport").toBeLessThanOrEqual(widths.view + 1);
  expect(widths.main, "<main> content is wider than <main>").toBeLessThanOrEqual(widths.mainClient + 1);
}

async function expectWithinViewport(page: Page, selector: Locator) {
  const box = await selector.boundingBox();
  const size = page.viewportSize()!;
  expect(box, "element has a box").not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
}

/** Scroll normally, then check both geometry and hit testing. No force-clicks. */
async function expectReachable(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expectWithinViewport(page, control);
  await control.click({ trial: true });
}

async function expectInsideHorizontally(element: Locator, container: Locator) {
  const inner = await element.boundingBox();
  const outer = await container.boundingBox();
  expect(inner).not.toBeNull();
  expect(outer).not.toBeNull();
  expect(inner!.x).toBeGreaterThanOrEqual(outer!.x - 1);
  expect(inner!.x + inner!.width).toBeLessThanOrEqual(outer!.x + outer!.width + 1);
}

/** Headings alone can appear before the requests that populate these pages. */
async function expectLoaded(page: Page, name: string) {
  const main = page.locator("main");
  switch (name) {
    case "organizations":
      await expect(main.locator(`a[href="/organizations/${organizationId}"]`)).toBeVisible();
      break;
    case "organization detail":
      await expect(main.getByRole("button", { name: "Rename", exact: true })).toBeVisible();
      break;
    case "members":
      await expect(main.getByText(owner.email, { exact: true })).toBeVisible();
      break;
    case "projects":
      await expect(main.getByRole("link", { name: "Responsive fixture", exact: true })).toBeVisible();
      break;
    case "project dashboard":
      await expect(main.getByTestId("metric").filter({ has: page.getByText("Traces", { exact: true }) }).locator("dd"))
        .toHaveText(String(goldenBodies.length));
      await expect(main.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
      break;
    case "documents":
      await expect(main.getByRole("cell", { name: documentName, exact: true })).toBeVisible();
      break;
    case "traces":
      await expect(main.getByRole("link", { name: /^View trace / })).toHaveCount(goldenBodies.length);
      break;
    case "trace detail":
      await expect(main.getByTestId("trace-metadata")).toBeVisible();
      break;
    case "api keys":
      await expect(main.getByRole("list", { name: "API keys", exact: true })).toContainText("e2e traces");
      break;
    default:
      throw new Error(`Missing loaded-state assertion for ${name}`);
  }
  if (name === "traces" || name === "project dashboard") {
    await expect(main.getByLabel("Provider", { exact: true }).locator('option[value="fixture-a"]')).toHaveCount(1);
  }
  await expect(main.getByRole("alert")).toHaveCount(0);
}

const orgBase = () => `/organizations/${organizationId}`;
const projectBase = () => `${orgBase()}/projects/${projectId}`;
const period = goldenSearch();

const publicPages = ["/", "/signin", "/signup", "/privacy", "/terms"];
const appPages: [string, () => string][] = [
  ["organizations", () => "/organizations"],
  ["organization detail", () => orgBase()],
  ["members", () => `${orgBase()}/members`],
  ["projects", () => `${orgBase()}/projects`],
  ["project dashboard", () => `${projectBase()}${period}`],
  ["documents", () => `${projectBase()}/documents`],
  ["traces", () => tracesPath(organizationId, projectId, period)],
  ["trace detail", () => `${projectBase()}/traces/${traceId}`],
  ["api keys", () => `${projectBase()}/api-keys`],
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const path of publicPages) {
      test(`public page ${path} has no horizontal overflow`, async ({ page }) => {
        await page.goto(path);
        // Sign-in and sign-up titles are not headings (CardTitle), so also accept the form.
        await expect(page.locator("h1, h2, form").first()).toBeVisible();
        await expectNoHorizontalOverflow(page);
      });
    }

    for (const [name, url] of appPages) {
      test(`${name} has no horizontal overflow`, async ({ page }) => {
        await signInPage(page, owner);
        await page.goto(url());
        await expectLoaded(page, name);
        await expectNoHorizontalOverflow(page);
      });
    }

    test("navigation is a sidebar from 768px and a drawer below", async ({ page }) => {
      await signInPage(page, owner);
      await page.goto(`${orgBase()}/members`);
      const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
      const menu = page.getByRole("button", { name: "Open menu" });
      if (viewport.width >= 768) {
        await expect(sidebar).toBeVisible();
        await expect(menu).toHaveCount(0);
      } else {
        await expect(sidebar).toHaveCount(0);
        await menu.click();
        const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
        await expect(drawer).toBeVisible();
        await expectWithinViewport(page, drawer);
        await drawer.getByRole("link", { name: "Members" }).click();
        await expect(drawer).toHaveCount(0);
      }
    });

    test("legal footer stays at the bottom of a short page", async ({ page }) => {
      await signInPage(page, owner);
      await page.goto(orgBase());
      await expectLoaded(page, "organization detail");
      const footer = page.locator("main footer");
      await expect(footer).toBeVisible();
      const box = await footer.boundingBox();
      // main has at most 24px padding below the footer.
      expect(box!.y + box!.height).toBeGreaterThanOrEqual(viewport.height - 40);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
    });

    test("the trace list stays readable and keeps its rows", async ({ page }) => {
      await signInPage(page, owner);
      await page.goto(tracesPath(organizationId, projectId, period));
      await expectLoaded(page, "traces");
      const ids = await visibleExternalIds(page);
      expect(ids.length).toBe(goldenBodies.length);
      const table = page.locator("main table");
      const container = table.locator("..");
      await expect(container).toHaveCSS("overflow-x", "auto");
      // Being in the DOM is not proof that a column is reachable: scroll to each one.
      for (const header of await table.getByRole("columnheader").all()) {
        await header.scrollIntoViewIfNeeded();
        await expectWithinViewport(page, header);
        await expectInsideHorizontally(header, container);
      }
      const detail = table.getByRole("link", { name: /^View trace / }).first();
      await expectReachable(page, detail);
      await expectInsideHorizontally(detail, container);
      await expectNoHorizontalOverflow(page);
      await detail.click();
      await expectLoaded(page, "trace detail");
    });

    for (const name of ["project dashboard", "traces"]) {
      test(`${name} date inputs and actions stay reachable inside the form`, async ({ page }) => {
        await signInPage(page, owner);
        await page.goto(name === "traces" ? tracesPath(organizationId, projectId, period) : `${projectBase()}${period}`);
        await expectLoaded(page, name);
        const form = page.getByRole("form", { name: name === "traces" ? "Trace filters" : "Custom period" });
        for (const label of ["From (UTC)", "To (UTC)"]) {
          const input = form.getByLabel(label, { exact: true });
          await expectReachable(page, input);
          await expectInsideHorizontally(input, form);
        }
        const apply = form.getByRole("button", { name: "Apply period", exact: true });
        await expectReachable(page, apply);
        await expectInsideHorizontally(apply, form);
        await apply.click();
        await expectLoaded(page, name);
        await expectReachable(page, page.locator("main").getByRole("button", { name: "Reset", exact: true }));
        if (name === "project dashboard") {
          await expectReachable(page, page.locator("main").getByRole("button", { name: "Refresh", exact: true }));
        }
        await expectNoHorizontalOverflow(page);
      });
    }

    test("a 100-character organization name stays readable in the list, detail, dialog and switcher", async ({ page }) => {
      await signInPage(page, owner);
      await page.goto("/organizations");
      const link = page.locator(`main a[href="/organizations/${longOrganizationId}"]`);
      await expect(link).toContainText(longOrganizationName);
      await expectNoHorizontalOverflow(page);
      await link.click();
      await expect(page.getByRole("heading", { name: `Detail of ${longOrganizationName}`, exact: true })).toBeVisible();
      await expectInsideHorizontally(
        page.locator("main").getByText(longOrganizationName, { exact: true }),
        page.locator('main [data-slot="card"]'),
      );
      await expectNoHorizontalOverflow(page);
      await page.getByRole("button", { name: "Rename", exact: true }).click();
      await expect(page.getByLabel("Organization name", { exact: true })).toHaveValue(longOrganizationName);
      await expectReachable(page, page.getByRole("button", { name: "Save", exact: true }));
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Delete organization", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Delete organization", exact: true });
      await expect(dialog).toContainText(longOrganizationName);
      await expectWithinViewport(page, dialog);
      expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await expectReachable(page, dialog.getByRole("button", { name: "Cancel", exact: true }));
      // Only inspect/cancel: this layout test must not delete even its own fixture.
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      if (viewport.width < 768) await page.getByRole("button", { name: "Open menu" }).click();
      await page.getByRole("button", { name: "Choose organization" }).click();
      const item = page.getByRole("menuitem", { name: longOrganizationName, exact: true });
      await expectReachable(page, item);
      expect(await item.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await page.keyboard.press("Escape");
    });

    test("the assistant panel fits the screen", async ({ page }) => {
      await signInPage(page, owner);
      await page.goto(`${projectBase()}${period}`);
      await expectLoaded(page, "project dashboard");
      await page.getByRole("button", { name: "Ask assistant", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Ask assistant" });
      await expect(dialog).toBeVisible();
      await expectWithinViewport(page, dialog);
      await expect(page.getByRole("button", { name: "Close assistant" })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Ask", exact: true })).toBeVisible();
    });

    test("html and body do not hide overflow", async ({ page }) => {
      await page.goto("/");
      for (const authenticated of [false, true]) {
        if (authenticated) {
          await signInPage(page, owner);
          await page.goto(tracesPath(organizationId, projectId, period));
          await expectLoaded(page, "traces");
        }
        const overflow = await page.evaluate(() => [document.documentElement, document.body].map(el => getComputedStyle(el).overflowX));
        expect(overflow).not.toContain("hidden");
        expect(overflow).not.toContain("clip");
      }
    });
  });
}

test("the same page keeps its URL and content when the window is resized", async ({ page }) => {
  await signInPage(page, owner);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(tracesPath(organizationId, projectId, period));
  await expectLoaded(page, "traces");
  const url = page.url();
  const before = await visibleExternalIds(page);
  expect(before.length).toBeGreaterThan(0);

  for (const size of [{ width: 768, height: 1024 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    await expect(page.getByTestId("trace-summary")).toBeVisible();
    expect(page.url()).toBe(url);
    expect(await visibleExternalIds(page)).toEqual(before);
    await expectNoHorizontalOverflow(page);
  }
});

test("an open assistant keeps its draft when the window is resized", async ({ page }) => {
  await signInPage(page, owner);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${projectBase()}${period}`);
  await expectLoaded(page, "project dashboard");
  await page.getByRole("button", { name: "Ask assistant", exact: true }).click();
  const box = page.getByPlaceholder("Ask a new question…");
  await box.fill("Which model costs the most?");
  for (const size of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    await expect(page.getByRole("dialog", { name: "Ask assistant" })).toBeVisible();
    await expect(box).toHaveValue("Which model costs the most?");
    await expectWithinViewport(page, page.getByRole("dialog", { name: "Ask assistant" }));
  }
});
