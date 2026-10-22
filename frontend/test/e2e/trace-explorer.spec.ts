import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type WebSocketRoute,
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
  replacePublic, requireCatalogue, tracesPath, visibleExternalIds, type Ingested, type TraceBody,
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
  "ADMIN and MEMBER read traces; a parent archive clears rows without a manual refresh and without logout",
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
        // The realtime notice (access.revoked) clears the protected content: no manual Refresh.

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


// ---- Realtime refresh of the real Explorer (TSE-87) ----
// A receiving browser stays open on the real screen while a separate authorized client (the public API)
// changes traces. Nothing below reloads, clicks Refresh or waits for a timer: the Explorer has no such trigger.

const rtBody = (externalId: string, occurredAt: string): TraceBody =>
  ({ ...fixtureBodies("traces-golden.json")[0], externalId, occurredAt });

async function realtimeProject(request: APIRequestContext, name: string) {
  const projectId = await createProject(request, owner, organizationId, name);
  const key = await createApiKey(request, owner, organizationId, projectId);
  return { projectId, key };
}

const LIST_READ = /\/projects\/[^/]+\/traces$/;
const DETAIL_READ = /\/projects\/[^/]+\/traces\/[0-9a-f-]{36}$/;

/** What a receiving page saw: realtime notices, HTTP reads of its own resource, WebSocket opens, full page loads. */
function observeRealtime(page: Page, readPath: RegExp) {
  const notices: number[] = [];
  const noticeProjects = new Set<string>();
  const reads: number[] = [];
  const sockets: string[] = [];
  let loads = 0;
  let closes = 0;
  const revoked: number[] = [];
  const note = (text: string) => {
    if (text.includes("access.revoked")) revoked.push(Date.now());
    if (!text.includes("traces.changed")) return;
    notices.push(Date.now());
    for (const match of text.matchAll(/"projectId":"([0-9a-f-]{36})"/g)) noticeProjects.add(match[1]);
  };
  page.on("load", () => { loads += 1; });
  page.on("websocket", socket => {
    sockets.push(socket.url());
    socket.on("close", () => { closes += 1; });
    socket.on("framereceived", frame => note(String(frame.payload)));
  });
  page.on("response", response => {
    const url = response.url();
    if (!url.includes("/socket.io/") || !url.includes("transport=polling")) return;
    response.text().then(note, () => { /* the page closed before the body arrived */ });
  });
  page.on("request", request => {
    if (request.method() === "GET" && readPath.test(new URL(request.url()).pathname)) reads.push(Date.now());
  });
  return { notices, noticeProjects, revoked, reads, sockets, loads: () => loads, closes: () => closes };
}
type Observed = ReturnType<typeof observeRealtime>;

/** The subscription is acknowledged once the page has read a second time (first load, then the acknowledgement). */
const subscribed = (seen: Observed) =>
  expect.poll(() => seen.reads.length, { message: "realtime subscription acknowledged" }).toBeGreaterThanOrEqual(2);

/** The screen changed because a notice arrived and an HTTP read followed, never because of a reload. */
function expectNoticeThenRead(seen: Observed, readsBefore: number) {
  expect(seen.notices.length, "a traces.changed notice reached the page").toBeGreaterThan(0);
  expect(seen.reads.length, "an HTTP read followed the notice").toBeGreaterThan(readsBefore);
  expect(seen.loads(), "the page was never reloaded").toBe(1);
}

test("realtime: a matching ingestion updates the list, the count and the order without a reload", async ({ page, request }) => {
  const { projectId, key } = await realtimeProject(request, "RT ingest");
  await ingest(request, key, rtBody("rt-old", "2026-10-01T09:00:00.000Z"));
  const seen = observeRealtime(page, LIST_READ);
  await open(page, projectId);
  await idsEqual(page, ["rt-old"]);
  await expect(summary(page)).toHaveText("1 traces · Page 1 of 1");
  await subscribed(seen);

  const readsBefore = seen.reads.length;
  await ingest(request, key, rtBody("rt-new", "2026-10-01T12:00:00.000Z"));
  await idsEqual(page, ["rt-new", "rt-old"]); // server order: newest first
  await expect(summary(page)).toHaveText("2 traces · Page 1 of 1");
  expectNoticeThenRead(seen, readsBefore);
  expect(seen.sockets.some(url => url.includes("/socket.io/")), "a WebSocket was opened").toBe(true);
  await expect(page).toHaveURL(new RegExp(`from=${GOLDEN_FROM.replace(/:/g, "(:|%3A)")}`)); // applied period unchanged
});

test("realtime: a corrected trace updates the list row and an open detail", async ({ page, request }) => {
  const { projectId, key } = await realtimeProject(request, "RT correct");
  const created = await ingest(request, key, rtBody("rt-fix", "2026-10-01T10:00:00.000Z"));
  const list = observeRealtime(page, LIST_READ);
  await open(page, projectId);
  await idsEqual(page, ["rt-fix"]);
  await expect(page.getByText("$0.0018", { exact: true })).toBeVisible();

  const detailPage = await page.context().newPage();
  const detail = observeRealtime(detailPage, DETAIL_READ);
  await detailPage.goto(`${tracesPath(organizationId, projectId)}/${created.id}`);
  await expect(detailPage.getByText("$0.001800000000", { exact: true })).toBeVisible();
  await subscribed(list);
  await subscribed(detail);

  const listBefore = list.reads.length;
  const detailBefore = detail.reads.length;
  await replacePublic(request, key, created, { ...rtBody("rt-fix", "2026-10-01T10:00:00.000Z"), inputTokens: 3000 });
  await expect(page.getByText("$0.0038", { exact: true })).toBeVisible();
  await expect(detailPage.getByText("$0.003800000000", { exact: true })).toBeVisible();
  expectNoticeThenRead(list, listBefore);
  expectNoticeThenRead(detail, detailBefore);
});

test("realtime: deleting the open trace clears the detail with a not-found state and keeps the session", async ({ page, request }) => {
  const { projectId, key } = await realtimeProject(request, "RT delete open");
  const created = await ingest(request, key, rtBody("rt-gone", "2026-10-01T10:00:00.000Z"));
  const seen = observeRealtime(page, DETAIL_READ);
  await signInPage(page, owner);
  await page.goto(`${tracesPath(organizationId, projectId)}/${created.id}`);
  await expect(page.getByText("Trace rt-gone")).toBeVisible();
  await subscribed(seen);

  const readsBefore = seen.reads.length;
  await deletePublic(request, key, created);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText("Trace rt-gone")).toHaveCount(0);
  await expect(page.getByTestId("trace-metadata")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "← Back to traces" })).toBeVisible();
  expectNoticeThenRead(seen, readsBefore);
  expect(await page.evaluate(() => Boolean(localStorage.getItem("tokenscope.accessToken")))).toBe(true);
});


test("realtime: a change in another project does not reach this Explorer", async ({ page, request }) => {
  const mine = await realtimeProject(request, "RT mine");
  const other = await realtimeProject(request, "RT other");
  await ingest(request, mine.key, rtBody("mine-1", "2026-10-01T09:00:00.000Z"));
  const seen = observeRealtime(page, LIST_READ);
  await open(page, mine.projectId);
  await idsEqual(page, ["mine-1"]);
  await subscribed(seen);

  await ingest(request, other.key, rtBody("other-1", "2026-10-01T10:00:00.000Z"));
  // Positive control: a change of MY project still arrives, so the earlier silence is meaningful.
  await ingest(request, mine.key, rtBody("mine-2", "2026-10-01T11:00:00.000Z"));
  await idsEqual(page, ["mine-2", "mine-1"]);
  expect([...seen.noticeProjects], "only notices of this project reached the page").toEqual([mine.projectId]);
  expect(await visibleExternalIds(page)).not.toContain("other-1");
});

test("realtime: changes outside the applied filter and period stay excluded and the query is unchanged", async ({ page, request }) => {
  const { projectId, key } = await realtimeProject(request, "RT excluded");
  await ingest(request, key, { ...rtBody("f-err-1", "2026-10-01T10:00:00.000Z"), status: "ERROR" });
  const seen = observeRealtime(page, LIST_READ);
  await open(page, projectId, goldenSearch("&status=ERROR"));
  await idsEqual(page, ["f-err-1"]);
  await subscribed(seen);
  const urlBefore = page.url();

  const readsBefore = seen.reads.length;
  await ingest(request, key, rtBody("f-ok", "2026-10-01T10:30:00.000Z")); // SUCCESS: excluded by the status filter
  await ingest(request, key, { ...rtBody("f-late", "2026-10-05T10:00:00.000Z"), status: "ERROR" }); // outside the period
  await ingest(request, key, { ...rtBody("f-err-2", "2026-10-01T11:00:00.000Z"), status: "ERROR" }); // positive control
  await idsEqual(page, ["f-err-2", "f-err-1"]);
  await expect(summary(page)).toHaveText("2 traces · Page 1 of 1");
  expect(await visibleExternalIds(page)).not.toContain("f-ok");
  expect(await visibleExternalIds(page)).not.toContain("f-late");
  expect(page.url(), "the applied query is unchanged").toBe(urlBefore);
  expectNoticeThenRead(seen, readsBefore);
});

test("realtime: switching projects while a notice is pending never shows the old project", async ({ page, request }) => {
  const a = await realtimeProject(request, "RT switch A");
  const b = await realtimeProject(request, "RT switch B");
  await ingest(request, a.key, rtBody("a-1", "2026-10-01T09:00:00.000Z"));
  await ingest(request, b.key, rtBody("b-1", "2026-10-01T09:30:00.000Z"));
  const seen = observeRealtime(page, LIST_READ);
  await open(page, a.projectId);
  await idsEqual(page, ["a-1"]);
  await subscribed(seen);

  await ingest(request, a.key, rtBody("a-2", "2026-10-01T10:00:00.000Z")); // a notice for A is on its way...
  await page.evaluate(path => { // ...and the person moves to B inside the app (no reload)
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, tracesPath(organizationId, b.projectId, goldenSearch()));
  await idsEqual(page, ["b-1"]);

  // Positive control in the new project: it is subscribed and refreshes, and nothing of A ever shows.
  await ingest(request, b.key, rtBody("b-2", "2026-10-01T11:00:00.000Z"));
  await idsEqual(page, ["b-2", "b-1"]);
  await expect(page.getByText(/^a-[12]$/)).toHaveCount(0);
  expect(seen.loads(), "the page was never reloaded").toBe(1);
});


test("realtime: changes made while the receiver is disconnected appear after the subscription recovers", async ({ page, request }) => {
  const { projectId, key } = await realtimeProject(request, "RT reconnect");
  await ingest(request, key, rtBody("rc-1", "2026-10-01T09:00:00.000Z"));

  // Test-only network control: while `down`, the page can neither open nor keep a realtime connection.
  let down = false;
  const routes: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/socket\.io\//, ws => {
    if (down) { void ws.close(); return; }
    routes.push(ws, ws.connectToServer());
  });
  await page.route(/\/socket\.io\//, route => (down ? route.abort() : route.continue()));

  const seen = observeRealtime(page, LIST_READ);
  await open(page, projectId);
  await idsEqual(page, ["rc-1"]);
  await subscribed(seen);
  await expect.poll(() => seen.sockets.length, { message: "the WebSocket transport is in use" }).toBeGreaterThan(0);

  down = true;
  await Promise.all(routes.splice(0).map(ws => ws.close()));
  await expect.poll(() => seen.closes(), { message: "the WebSocket is really closed" }).toBeGreaterThan(0);
  const readsWhileDown = seen.reads.length;
  await ingest(request, key, rtBody("rc-2", "2026-10-01T10:00:00.000Z")); // missed by the disconnected page
  expect(await visibleExternalIds(page)).toEqual(["rc-1"]);
  expect(seen.reads.length, "no read while disconnected").toBe(readsWhileDown);

  down = false; // the client reconnects on its own backoff, subscribes again and reads again
  await expect.poll(() => visibleExternalIds(page), { timeout: 45_000 }).toEqual(["rc-2", "rc-1"]);
  expect(seen.notices.length, "recovered by the subscription acknowledgement, not by a replayed notice").toBe(0);
  expect(seen.loads(), "the page was never reloaded").toBe(1);
});

test("realtime: removing the receiving member clears the protected content and keeps the session", async ({ browser, baseURL, request }) => {
  const { projectId, key } = await realtimeProject(request, "RT member removal");
  await ingest(request, key, rtBody("rm-1", "2026-10-01T09:00:00.000Z"));
  const member = await signUp(request, "explorer-removed");
  await addMember(request, owner, organizationId, member, "MEMBER");
  const context = await signedInContext(browser, baseURL, member);
  try {
    const page = await context.newPage();
    const seen = observeRealtime(page, LIST_READ);
    await page.goto(tracesPath(organizationId, projectId, goldenSearch()));
    await idsEqual(page, ["rm-1"]);
    await subscribed(seen);

    // The user id is the subject of the (disposable) test user's token.
    const userId = JSON.parse(atob(member.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub as string;
    const removed = await request.delete(`${API}/organizations/${organizationId}/members/${userId}`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(removed.status(), "remove member").toBeLessThan(300);

    await expect(page.getByText("This project is not available.")).toBeVisible();
    await expect(page.getByRole("link", { name: /^View trace / })).toHaveCount(0);
    expect(await page.evaluate(() => Boolean(localStorage.getItem("tokenscope.accessToken")))).toBe(true);
    expect(seen.revoked.length, "an access.revoked notice reached the page").toBeGreaterThan(0);
    expect(seen.reads.filter(at => at > seen.revoked[0]), "no HTTP read after the revocation: the notice alone cleared the screen").toHaveLength(0);
    expect((await apiGet(request, member, `${API}/organizations`)).status()).toBe(200);
    expect(seen.loads(), "the page was never reloaded").toBe(1);
  } finally {
    await context.close();
  }
});

test("realtime: archiving the organization clears the protected content and keeps the session", async ({ page, request }) => {
  const auth = { Authorization: `Bearer ${owner.token}` };
  const created = await request.post(`${API}/organizations`, { headers: auth, data: { name: `RT org archive ${Date.now()}` } });
  expect(created.status(), "create organization").toBe(201);
  const org = (await created.json()) as { id: string; slug: string };
  const projectId = await createProject(request, owner, org.id, "RT org archive");
  const key = await createApiKey(request, owner, org.id, projectId);
  await ingest(request, key, rtBody("oa-1", "2026-10-01T09:00:00.000Z"));

  const seen = observeRealtime(page, LIST_READ);
  await signInPage(page, owner);
  await page.goto(tracesPath(org.id, projectId, goldenSearch()));
  await idsEqual(page, ["oa-1"]);
  await subscribed(seen);

  const archived = await request.delete(`${API}/organizations/${org.id}`, { headers: auth, data: { confirmSlug: org.slug } });
  expect(archived.status(), "archive organization").toBe(204);

  await expect(page.getByText("This project is not available.")).toBeVisible();
  await expect(page.getByRole("link", { name: /^View trace / })).toHaveCount(0);
  expect(await page.evaluate(() => Boolean(localStorage.getItem("tokenscope.accessToken")))).toBe(true);
  expect((await apiGet(request, owner, `${API}/organizations`)).status()).toBe(200); // other organizations stay usable
  expect(seen.loads(), "the page was never reloaded").toBe(1);
});


test("realtime: deleting the only row of the last page recovers to the last valid page and keeps the query", async ({ page, request }) => {
  test.setTimeout(180_000); // 26 ingestions paced under the public API limit
  const { projectId, key } = await realtimeProject(request, "RT last page");
  const ingested = await ingestAll(request, key, fixtureBodies("traces-pagination.json").slice(0, 26));
  const seen = observeRealtime(page, LIST_READ);
  await open(page, projectId, goldenSearch("&page=2"));
  await expect(summary(page)).toHaveText("26 traces · Page 2 of 2");
  const onLastPage = await visibleExternalIds(page);
  expect(onLastPage).toHaveLength(1);
  await subscribed(seen);

  const readsBefore = seen.reads.length;
  await deletePublic(request, key, ingested.get(onLastPage[0])!);
  await expect(summary(page)).toHaveText("25 traces · Page 1 of 1");
  await expect(page).not.toHaveURL(/page=/); // back on the first page, recovered once
  await expect(page).toHaveURL(new RegExp(`from=${GOLDEN_FROM.replace(/:/g, "(:|%3A)")}`)); // the applied period is kept
  await expect(page.getByRole("link", { name: /^View trace / })).toHaveCount(25);
  expectNoticeThenRead(seen, readsBefore);
});
