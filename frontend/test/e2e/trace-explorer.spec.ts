import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import {
  addMember,
  apiGet,
  createOrganization,
  createProject,
  signedInContext,
  signInPage,
  signUp,
  type TestUser,
} from "./helpers";
import {
  GOLDEN_FROM, GOLDEN_TO, createApiKey, deletePublic, fixtureBodies, goldenSearch, ingest, ingestAll,
  requireCatalogue, tracesPath, visibleExternalIds, type Ingested, type TraceBody,
} from "./trace-helpers";

// Real frontend + backend + PostgreSQL. The golden and pagination fixtures are ingested through the real
// public API once; every scenario then drives the browser. The price catalogue must already be loaded
// (docs/LOCAL_DEVELOPMENT.md, "Trace Explorer browser tests").

test.describe.configure({ mode: "serial" });

const API = "/api/v1";
let owner: TestUser;
let organizationId: string;
let golden: { projectId: string };
let paged: { projectId: string; key: string; traces: Map<string, Ingested> };
let detail: { projectId: string };

test.beforeAll(async ({ playwright, baseURL }) => {
  test.setTimeout(240_000);
  const request = await playwright.request.newContext({ baseURL });
  owner = await signUp(request, "explorer-owner");
  await requireCatalogue(request, owner);
  organizationId = await createOrganization(request, owner);

  const goldenProject = await createProject(request, owner, organizationId, "E2E Golden");
  const goldenKey = await createApiKey(request, owner, organizationId, goldenProject);
  await ingestAll(request, goldenKey, fixtureBodies("traces-golden.json"));
  golden = { projectId: goldenProject };

  const pagedProject = await createProject(request, owner, organizationId, "E2E Pagination");
  const pagedKey = await createApiKey(request, owner, organizationId, pagedProject);
  const pagedBodies = fixtureBodies("traces-pagination.json");
  expect(pagedBodies).toHaveLength(51);
  for (const body of pagedBodies) {
    expect(body.occurredAt >= GOLDEN_FROM && body.occurredAt < GOLDEN_TO, `${body.externalId} is inside the golden period`).toBe(true);
  }
  paged = { projectId: pagedProject, key: pagedKey, traces: await ingestAll(request, pagedKey, pagedBodies) };

  const detailProject = await createProject(request, owner, organizationId, "E2E Detail");
  const detailKey = await createApiKey(request, owner, organizationId, detailProject);
  const hostile: TraceBody = {
    ...fixtureBodies("traces-golden.json")[0], externalId: "hostile-001",
    metadata: { note: "<img src=x onerror=window.__xss=1>", count: 3, flag: true, none: null },
  };
  await ingest(request, detailKey, hostile);
  await ingest(request, detailKey, fixtureBodies("traces-golden.json")[0]);
  detail = { projectId: detailProject };
  await request.dispose();
});

async function open(page: Page, projectId: string, search = goldenSearch()) {
  await signInPage(page, owner);
  await page.goto(tracesPath(organizationId, projectId, search));
}
const summary = (page: Page) => page.getByTestId("trace-summary");
const idsEqual = (page: Page, expected: string[]) => expect.poll(() => visibleExternalIds(page)).toEqual(expected);

test("the golden period lists the six traces with exact totals", async ({ page, request }) => {
  await open(page, golden.projectId);
  await idsEqual(page, ["golden-006", "golden-005", "golden-004", "golden-003", "golden-002", "golden-001"]);
  await expect(summary(page)).toHaveText("6 traces · Page 1 of 1");
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await expect(page.getByText("2026-10-01 10:00:00 UTC").first()).toBeVisible();
  await expect(page.getByText("$0.0018", { exact: true }).first()).toBeVisible();

  // The same fixture through the real API, two rows per page: the backend contract the screen relies on.
  const expected = [["golden-006", "golden-005"], ["golden-004", "golden-003"], ["golden-002", "golden-001"]];
  for (const [index, ids] of expected.entries()) {
    const url = `${API}/organizations/${organizationId}/projects/${golden.projectId}/traces?from=${GOLDEN_FROM}&to=${GOLDEN_TO}&pageSize=2&page=${index + 1}`;
    const body = await (await apiGet(request, owner, url)).json();
    expect(body.items.map((item: { externalId: string }) => item.externalId)).toEqual(ids);
    expect(body.total).toBe(6);
  }
});

test("a custom period is applied only on Apply and an empty period is not an error", async ({ page }) => {
  await open(page, golden.projectId);
  await idsEqual(page, ["golden-006", "golden-005", "golden-004", "golden-003", "golden-002", "golden-001"]);
  await page.getByLabel("From (UTC)").fill("2026-10-02T00:00");
  await page.getByLabel("To (UTC)").fill("2026-10-03T00:00");
  await expect(page).toHaveURL(/from=2026-10-01T00(:|%3A)00(:|%3A)00\.000Z/); // not applied yet
  await page.getByRole("button", { name: "Apply period" }).click();
  await expect(page.getByText("No traces match this period and these filters.")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page).toHaveURL(/from=2026-10-02T00(:|%3A)00(:|%3A)00\.000Z/);
  await page.goBack();
  await idsEqual(page, ["golden-006", "golden-005", "golden-004", "golden-003", "golden-002", "golden-001"]);
});

test("search is case-insensitive, lives in the URL and survives reload and Back/Forward", async ({ page }) => {
  await open(page, golden.projectId);
  await idsEqual(page, ["golden-006", "golden-005", "golden-004", "golden-003", "golden-002", "golden-001"]);
  await page.getByLabel("Search").fill("SUPPORT");
  await expect(page).toHaveURL(/q=SUPPORT/);
  await expect.poll(async () => (await visibleExternalIds(page)).sort()).toEqual(["golden-001", "golden-003", "golden-004"]);
  await page.reload();
  await expect(page.getByLabel("Search")).toHaveValue("SUPPORT");
  await expect.poll(async () => (await visibleExternalIds(page)).sort()).toEqual(["golden-001", "golden-003", "golden-004"]);

  // Typing replaces the entry, so one Back leaves the filtered list entirely.
  await page.getByLabel("Status").selectOption("ERROR");
  await expect(page).toHaveURL(/status=ERROR/);
  await page.goBack();
  await expect(page.getByLabel("Status")).toHaveValue("");
  await page.goForward();
  await expect(page.getByLabel("Status")).toHaveValue("ERROR");
});

test("provider and status filters combine, and changing the provider clears the model", async ({ page }) => {
  await open(page, golden.projectId);
  await expect(page.getByLabel("Provider").locator("option"))
  .toContainText(["All providers", "fixture-a", "fixture-b"]);
  await page.getByLabel("Provider").selectOption("fixture-a");
  await page.getByLabel("Model").selectOption("demo-fast");
  await expect(page).toHaveURL(/model=demo-fast/);
  await page.getByLabel("Provider").selectOption("fixture-b");
  await expect(page.getByLabel("Model")).toHaveValue("");
  await expect(page).not.toHaveURL(/model=/);
  await page.getByLabel("Status").selectOption("ERROR");
  await expect.poll(async () => (await visibleExternalIds(page)).sort()).toEqual(["golden-004", "golden-006"]);
  await expect(summary(page)).toContainText("2 traces");
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByLabel("Provider")).toHaveValue("");
  await expect(page).not.toHaveURL(/provider=|status=/);
});

test("sorting by estimated cost reorders the real list and is shareable", async ({ page }) => {
  await open(page, golden.projectId);
  await idsEqual(page, ["golden-006", "golden-005", "golden-004", "golden-003", "golden-002", "golden-001"]);
  await page.getByRole("button", { name: /^Estimated cost/ }).click();
  await expect(page).toHaveURL(/sortBy=estimatedCostUsd/);
  await idsEqual(page, ["golden-006", "golden-002", "golden-003", "golden-001", "golden-005", "golden-004"]);
  await page.reload();
  await idsEqual(page, ["golden-006", "golden-002", "golden-003", "golden-001", "golden-005", "golden-004"]);
  await page.getByRole("button", { name: /^Estimated cost/ }).click();
  await expect(page).toHaveURL(/sortOrder=asc/);
  await idsEqual(page, ["golden-004", "golden-005", "golden-001", "golden-003", "golden-002", "golden-006"]);
});

test("51 traces paginate 25, 25 and 1 with disabled bounds, and page size resets the page", async ({ page }) => {
  await open(page, paged.projectId);
  await expect(summary(page)).toHaveText("51 traces · Page 1 of 3");
  await expect(page.getByRole("link", { name: /^View trace / })).toHaveCount(25);
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(summary(page)).toHaveText("51 traces · Page 2 of 3");
  await expect(page.getByRole("link", { name: /^View trace / })).toHaveCount(25);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(summary(page)).toHaveText("51 traces · Page 3 of 3");
  await expect(page.getByRole("link", { name: /^View trace / })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await page.getByLabel("Rows per page").selectOption("50");
  await expect(summary(page)).toHaveText("51 traces · Page 1 of 2");
  await expect(page.getByRole("link", { name: /^View trace / })).toHaveCount(50);
});

test("a page beyond the end is empty at the API and recovers to the last page in the browser", async ({ page, request }) => {
  const url = `${API}/organizations/${organizationId}/projects/${paged.projectId}/traces?from=${GOLDEN_FROM}&to=${GOLDEN_TO}&pageSize=25&page=4`;
  const body = await (await apiGet(request, owner, url)).json();
  expect(body.items).toEqual([]);
  expect(body.total).toBe(51);

  await open(page, paged.projectId, goldenSearch("&page=4"));
  await expect(page).toHaveURL(/page=3/);
  await expect(summary(page)).toHaveText("51 traces · Page 3 of 3");
  await expect(page.getByRole("link", { name: /^View trace / })).toHaveCount(1);
});

test("the detail shows every recorded fact, escapes metadata and keeps the way back", async ({ page }) => {
  await open(page, detail.projectId);
  await page.getByLabel("Search").fill("support");
  await expect(page).toHaveURL(/q=support/);
  await page.getByRole("link", { name: "View trace golden-001" }).click();
  await expect(page.getByRole("heading", { name: "Trace golden-001" })).toBeVisible();
  for (const text of ["1000", "200", "$1.000000 per million tokens", "$4.000000 per million tokens",
    "$0.001000000000", "$0.000800000000", "$0.001800000000", "2026-10-01 10:00:00 UTC"]) {
    await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
  }
  await expect(page.getByText(/Synthetic pricing/)).toBeVisible();
  await page.getByRole("link", { name: "← Back to traces" }).click();
  await expect(page).toHaveURL(/q=support/);

  await page.getByRole("link", { name: "View trace hostile-001" }).click();
  await expect(page.getByTestId("trace-metadata")).toContainText("<img src=x onerror=window.__xss=1>");
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await expect(page.getByTestId("trace-metadata").locator("img")).toHaveCount(0);
});

test("a direct detail link returns to the default list, and an unknown trace is a clear detail-only error", async ({ page }) => {
  await signInPage(page, owner);
  await page.goto(tracesPath(organizationId, detail.projectId, goldenSearch()));
  await page.getByRole("link", { name: "View trace golden-001" }).click();
  const detailUrl = page.url();

  await page.goto("about:blank");
  await page.goto(detailUrl);
  await page.getByRole("link", { name: "← Back to traces" }).click();
  await expect(page).toHaveURL(/\/traces\?from=.*&to=/);
  await expect(page).not.toHaveURL(/q=/);

  await page.goto(`/organizations/${organizationId}/projects/${detail.projectId}/traces/00000000-0000-4000-8000-00000000dead`);
  await expect(page.getByText("This trace no longer exists.")).toBeVisible();
  await expect(page.getByRole("link", { name: "← Back to traces" })).toBeVisible();
});

test("an invalid link is rejected visibly and another tenant never sees the project", async ({ page, request, browser, baseURL }) => {
  await open(page, golden.projectId, goldenSearch("&page=0&q=a&q=b"));
  await expect(page.getByText("This link contains filters that cannot be applied:")).toBeVisible();
  await expect(page.getByRole("link", { name: /^View trace / })).toHaveCount(0);
  await page.getByRole("button", { name: "Reset" }).first().click();
  await expect(page.getByText("This link contains filters that cannot be applied:")).toHaveCount(0);
  await expect(page).toHaveURL(/\/traces\?from=[^&]+&to=[^&]+$/);

  const outsider = await signUp(request, "explorer-outsider");
  const other = await browser.newContext({ baseURL, });
  await other.addInitScript(token => localStorage.setItem("tokenscope.accessToken", token), outsider.token);
  const outsiderPage = await other.newPage();
  await outsiderPage.goto(tracesPath(organizationId, golden.projectId, goldenSearch()));
  await expect(outsiderPage.getByText("This project is not available.")).toBeVisible();
  await expect(outsiderPage.getByRole("link", { name: /^View trace / })).toHaveCount(0);
  await other.close();
});
test(
  "ADMIN and MEMBER read traces; a parent archive clears rows on refresh without logout",
  async ({ browser, baseURL, request }) => {
    // Use a separate project so archiving it cannot break other scenarios.
    const projectId = await createProject(
      request,
      owner,
      organizationId,
      "E2E archive access",
    );

    const key = await createApiKey(
      request,
      owner,
      organizationId,
      projectId,
    );

    const created = await ingest(
      request,
      key,
      fixtureBodies("traces-golden.json")[0],
    );

    const clients: {
      context: BrowserContext;
      page: Page;
      user: TestUser;
    }[] = [];

    try {
      for (const role of ["ADMIN", "MEMBER"] as const) {
        const user = await signUp(
          request,
          `explorer-${role.toLowerCase()}`,
        );

        await addMember(
          request,
          owner,
          organizationId,
          user,
          role,
        );

        const context = await signedInContext(
          browser,
          baseURL,
          user,
        );

        const page = await context.newPage();
        clients.push({ context, page, user });

        // Both roles can read the real list and recorded trace details.
        await page.goto(
          tracesPath(organizationId, projectId, goldenSearch()),
        );

        await expect(summary(page)).toHaveText(
          "1 traces · Page 1 of 1",
        );

        await page
          .getByRole("link", { name: "View trace golden-001" })
          .click();

        await expect(
          page.getByText("$0.001800000000", { exact: true }),
        ).toBeVisible();

        await page
          .getByRole("link", { name: "← Back to traces" })
          .click();

        await expect(summary(page)).toHaveText(
          "1 traces · Page 1 of 1",
        );
      }

      // An accessible project must not expose another project's trace.
      const mismatched = await apiGet(
        request,
        owner,
        `${API}/organizations/${organizationId}` +
          `/projects/${golden.projectId}/traces/${created.id}`,
      );

      expect(mismatched.status()).toBe(404);

      // Archive as OWNER while the ADMIN and MEMBER pages remain open.
      const archived = await request.delete(
        `${API}/organizations/${organizationId}/projects/${projectId}`,
        {
          headers: {
            Authorization: `Bearer ${owner.token}`,
          },
        },
      );

      expect(archived.status()).toBe(204);

      for (const { page, user } of clients) {
        // Current integration discovers remote access loss on HTTP refresh.
        await page
          .getByRole("button", { name: "Refresh", exact: true })
          .click();

        await expect(
          page.getByText("This project is not available."),
        ).toBeVisible();

        await expect(
          page.getByRole("link", { name: /^View trace / }),
        ).toHaveCount(0);

        // Losing project access must not invalidate the user's session.
        expect(
          await page.evaluate(() =>
            Boolean(localStorage.getItem("tokenscope.accessToken")),
          ),
        ).toBe(true);

        const organizations = await apiGet(
          request,
          user,
          `${API}/organizations`,
        );

        expect(organizations.status()).toBe(200);
      }
    } finally {
      await Promise.all(
        clients.map(({ context }) => context.close()),
      );
    }
  },
);
// Mutates the pagination project: keep it last.
test("deleting the last row of the last page recovers to the previous page", async ({ page, request }) => {
  await open(page, paged.projectId, goldenSearch("&page=3"));
  await expect(summary(page)).toHaveText("51 traces · Page 3 of 3");
  const [lastId] = await visibleExternalIds(page);
  const target = paged.traces.get(lastId);
  expect(target, "the single row of page 3 comes from the seeded fixture").toBeTruthy();

  await deletePublic(request, paged.key, target!);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(summary(page)).toHaveText("50 traces · Page 2 of 2");
  await expect(page.getByRole("link", { name: /^View trace / })).toHaveCount(25);
});
