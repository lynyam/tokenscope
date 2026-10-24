import { expect, test, type Page } from "@playwright/test";

import { createOrganization, createProject, signInPage, signUp, type TestUser } from "./helpers";
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

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(120_000);
  const request = await playwright.request.newContext({ baseURL });
  try {
    owner = await signUp(request, "responsive-owner");
    await requireCatalogue(request, owner);
    organizationId = await createOrganization(request, owner);
    projectId = await createProject(request, owner, organizationId, "Responsive fixture");
    const key = await createApiKey(request, owner, organizationId, projectId);
    const ingested = await ingestAll(request, key, fixtureBodies("traces-golden.json"));
    traceId = [...ingested.values()][0].id;
  } finally {
    await request.dispose();
  }
});

/** The page itself must never scroll sideways: wide content has to scroll inside its own container. */
async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    view: window.innerWidth,
    main: (document.querySelector("main") as HTMLElement | null)?.scrollWidth ?? 0,
    mainClient: (document.querySelector("main") as HTMLElement | null)?.clientWidth ?? 0,
  }));
  expect(widths.page, "document is wider than the viewport").toBeLessThanOrEqual(widths.view + 1);
  expect(widths.main, "<main> content is wider than <main>").toBeLessThanOrEqual(widths.mainClient + 1);
}

async function expectWithinViewport(page: Page, selector: ReturnType<Page["locator"]>) {
  const box = await selector.boundingBox();
  const size = page.viewportSize()!;
  expect(box, "element has a box").not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
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
        await expect(page.getByRole("heading").first()).toBeVisible();
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
      await page.goto("/organizations");
      await expect(page.getByRole("heading").first()).toBeVisible();
      const footer = page.locator("main footer");
      await expect(footer).toBeVisible();
      const box = await footer.boundingBox();
      // main has at most 24px padding below the footer.
      expect(box!.y + box!.height).toBeGreaterThanOrEqual(viewport.height - 40);
    });

    test("the trace list stays readable and keeps its rows", async ({ page }) => {
      await signInPage(page, owner);
      await page.goto(tracesPath(organizationId, projectId, period));
      await expect(page.getByTestId("trace-summary")).toBeVisible();
      const ids = await visibleExternalIds(page);
      expect(ids.length).toBeGreaterThan(0);
      await expectNoHorizontalOverflow(page);
    });

    test("the assistant panel fits the screen", async ({ page }) => {
      await signInPage(page, owner);
      await page.goto(`${projectBase()}${period}`);
      await page.getByRole("button", { name: "Ask assistant", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Ask assistant" });
      await expect(dialog).toBeVisible();
      await expectWithinViewport(page, dialog);
      await expect(page.getByRole("button", { name: "Close assistant" })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Ask", exact: true })).toBeVisible();
    });

    test("html and body do not hide overflow", async ({ page }) => {
      await page.goto("/");
      const overflow = await page.evaluate(() => [document.documentElement, document.body].map(el => getComputedStyle(el).overflowX));
      expect(overflow).not.toContain("hidden");
    });
  });
}

test("the same page keeps its URL and content when the window is resized", async ({ page }) => {
  await signInPage(page, owner);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(tracesPath(organizationId, projectId, period));
  await expect(page.getByTestId("trace-summary")).toBeVisible();
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