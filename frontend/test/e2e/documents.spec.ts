import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  addMember, apiGet, createOrganization, createProject, documentsApi, documentsPage, fixtureBytes, fixturePath,
  signInPage, signUp, signedInContext, trackRequests, uploadViaApi, type TestUser,
} from "./helpers";

// Real frontend + backend + PostgreSQL + private storage. Every test builds its own disposable users,
// organization and projects through the real API; successful flows use real responses.

const rowAction = (page: Page, action: "Preview" | "Download" | "Delete", name: string) =>
  page.getByRole("button", { name: new RegExp(`^${action} ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},`) });
const fileInput = (page: Page) => page.getByLabel(/Document \(PDF, TXT or Markdown/);
const firstLine = (name: string) => fixtureBytes(name).toString("utf8").split("\n").find(line => line.trim() !== "")!.trim();

async function workspace(request: Parameters<typeof signUp>[0]) {
  const owner = await signUp(request, "owner");
  const organizationId = await createOrganization(request, owner);
  const projectId = await createProject(request, owner, organizationId, "E2E Documents");
  return { owner, organizationId, projectId };
}

test.describe("OWNER upload", () => {
  test("a rapid double submission stores exactly one document, which persists after reload", async ({ page, request }) => {
    const { owner, organizationId, projectId } = await workspace(request);
    await signInPage(page, owner);
    const posts = trackRequests(page, "POST", /\/documents$/);
    await page.goto(documentsPage(organizationId, projectId));

    await fileInput(page).setInputFiles(fixturePath("sample-brief.pdf"));
    await expect(page.getByText("Selected: sample-brief.pdf")).toBeVisible();
    expect(posts).toHaveLength(0); // Selecting never uploads.
    // Two synchronous clicks: only the ref lock can stop the second one.
    await page.getByRole("button", { name: "Upload", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });

    await expect(page.getByText('"sample-brief.pdf" was uploaded.')).toBeVisible();
    await expect(rowAction(page, "Preview", "sample-brief.pdf")).toBeVisible();
    expect(posts).toHaveLength(1);

    await page.reload();
    await expect(rowAction(page, "Preview", "sample-brief.pdf")).toBeVisible();
    const list = await (await apiGet(request, owner, documentsApi(organizationId, projectId))).json();
    expect(list.total).toBe(1);
  });

  test("the server rejects content the local checks cannot judge, with a clear message", async ({ page, request }) => {
    const { owner, organizationId, projectId } = await workspace(request);
    await signInPage(page, owner);
    await page.goto(documentsPage(organizationId, projectId));

    await fileInput(page).setInputFiles(fixturePath("malformed.pdf"));
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(/could not be read|not supported/i);
    await expect(page.getByText(/No documents yet/)).toBeVisible();

    await fileInput(page).setInputFiles({ name: "notes.exe", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
    await expect(page.getByRole("alert")).toContainText(/PDF, TXT or Markdown/);
    await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeDisabled();
  });
});

test.describe("preview and download", () => {
  test("renders the real PDF's first page and previews TXT and Markdown as text; close and reopen work", async ({ page, request }) => {
    const { owner, organizationId, projectId } = await workspace(request);
    await uploadViaApi(request, owner, organizationId, projectId, "sample-brief.pdf", fixtureBytes("sample-brief.pdf"));
    await uploadViaApi(request, owner, organizationId, projectId, "sample-guide.md", fixtureBytes("sample-guide.md"));
    await uploadViaApi(request, owner, organizationId, projectId, "sample-policy.txt", fixtureBytes("sample-policy.txt"));
    await signInPage(page, owner);
    await page.goto(documentsPage(organizationId, projectId));

    for (let round = 0; round < 2; round += 1) { // Close and reopen succeeds.
      await rowAction(page, "Preview", "sample-brief.pdf").click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText(/^Page 1 of \d+$/)).toBeVisible();
      const dark = await dialog.locator("canvas").evaluate(canvas => {
        const element = canvas as HTMLCanvasElement;
        const data = element.getContext("2d")!.getImageData(0, 0, element.width, element.height).data;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] < 128) count += 1;
        return { count, longest: Math.max(element.width, element.height) };
      });
      expect(dark.count).toBeGreaterThan(0);          // Something was really drawn.
      expect(dark.longest).toBeLessThanOrEqual(1600); // Bounded canvas.
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }

    await rowAction(page, "Preview", "sample-guide.md").click();
    await expect(page.getByRole("dialog").locator("pre")).toContainText(firstLine("sample-guide.md"));
    await page.keyboard.press("Escape");
    await rowAction(page, "Preview", "sample-policy.txt").click();
    await expect(page.getByRole("dialog").locator("pre")).toContainText(firstLine("sample-policy.txt"));
  });

  test("HTML-like content is shown as text and never executes", async ({ page, request }) => {
    const { owner, organizationId, projectId } = await workspace(request);
    const source = '# Title\n<img src=x onerror="window.__pwned=1">\n<script>window.__pwned=1</script>\n[link](javascript:window.__pwned=1)';
    await uploadViaApi(request, owner, organizationId, projectId, "html-like.md", Buffer.from(source));
    await signInPage(page, owner);
    await page.goto(documentsPage(organizationId, projectId));
    await rowAction(page, "Preview", "html-like.md").click();
    const pre = page.getByRole("dialog").locator("pre");
    await expect(pre).toContainText('<img src=x onerror="window.__pwned=1">');
    await expect(pre.locator("img, script, a")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test("downloads the original bytes under the original filename", async ({ page, request }) => {
    const { owner, organizationId, projectId } = await workspace(request);
    await uploadViaApi(request, owner, organizationId, projectId, "sample-brief.pdf", fixtureBytes("sample-brief.pdf"));
    await signInPage(page, owner);
    await page.goto(documentsPage(organizationId, projectId));
    const [download] = await Promise.all([page.waitForEvent("download"), rowAction(page, "Download", "sample-brief.pdf").click()]);
    expect(download.suggestedFilename()).toBe("sample-brief.pdf");
    expect(readFileSync((await download.path())!).equals(fixtureBytes("sample-brief.pdf"))).toBe(true);
  });
});

test.describe("roles", () => {
  test("ADMIN uploads and deletes; MEMBER reads only and a direct MEMBER mutation is refused", async ({ browser, baseURL, request }) => {
    const { owner, organizationId, projectId } = await workspace(request);
    const admin = await signUp(request, "admin");
    const member = await signUp(request, "member");
    await addMember(request, owner, organizationId, admin, "ADMIN");
    await addMember(request, owner, organizationId, member, "MEMBER");
    await uploadViaApi(request, owner, organizationId, projectId, "sample-brief.pdf", fixtureBytes("sample-brief.pdf"));

    const adminContext = await signedInContext(browser, baseURL, admin);
    const adminPage = await adminContext.newPage();
    await adminPage.goto(documentsPage(organizationId, projectId));
    await fileInput(adminPage).setInputFiles(fixturePath("sample-policy.txt"));
    await adminPage.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(adminPage.getByText('"sample-policy.txt" was uploaded.')).toBeVisible();
    await rowAction(adminPage, "Delete", "sample-policy.txt").click();
    await adminPage.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(rowAction(adminPage, "Preview", "sample-policy.txt")).toHaveCount(0);
    await adminContext.close();

    const memberContext = await signedInContext(browser, baseURL, member);
    const memberPage = await memberContext.newPage();
    await memberPage.goto(documentsPage(organizationId, projectId));
    await expect(rowAction(memberPage, "Preview", "sample-brief.pdf")).toBeVisible();
    await expect(rowAction(memberPage, "Download", "sample-brief.pdf")).toBeVisible();
    await expect(fileInput(memberPage)).toHaveCount(0);
    await expect(memberPage.getByRole("button", { name: /^Delete / })).toHaveCount(0);
    await rowAction(memberPage, "Preview", "sample-brief.pdf").click();
    await expect(memberPage.getByRole("dialog").getByText(/^Page 1 of \d+$/)).toBeVisible();
    await memberContext.close();

    const forbidden = await request.post(documentsApi(organizationId, projectId), {
      headers: { Authorization: `Bearer ${member.token}` },
      multipart: { file: { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("x") } },
    });
    expect(forbidden.status()).toBe(403);
  });
});

test.describe("tenant isolation", () => {
  test("an outsider is denied, and a document cannot be fetched through another project", async ({ request }) => {
    const { owner, organizationId, projectId } = await workspace(request);
    const otherProjectId = await createProject(request, owner, organizationId, "Other project");
    const stored = await uploadViaApi(request, owner, organizationId, projectId, "sample-brief.pdf", fixtureBytes("sample-brief.pdf"));
    const outsider = await signUp(request, "outsider");

    for (const url of [documentsApi(organizationId, projectId), `${documentsApi(organizationId, projectId)}/${stored.id}/content`]) {
      const status = (await apiGet(request, outsider, url)).status();
      expect(status).toBe(404);
    }
    // Same organization, wrong project: the document id alone is not enough.
    const substituted = await apiGet(request, owner, `${documentsApi(organizationId, otherProjectId)}/${stored.id}/content`);
    expect(substituted.status()).toBe(404);
  });
});

test.describe("deletion", () => {
  test("Cancel sends nothing; confirming deletes once and the content is gone", async ({ page, request }) => {
    const { owner, organizationId, projectId } = await workspace(request);
    const stored = await uploadViaApi(request, owner, organizationId, projectId, "sample-guide.md", fixtureBytes("sample-guide.md"));
    await signInPage(page, owner);
    const deletes = trackRequests(page, "DELETE", /\/documents\/[^/]+$/);
    await page.goto(documentsPage(organizationId, projectId));

    await rowAction(page, "Delete", "sample-guide.md").click();
    await expect(page.getByRole("dialog")).toContainText("This action cannot be undone.");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(deletes).toHaveLength(0);

    await rowAction(page, "Delete", "sample-guide.md").click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(rowAction(page, "Preview", "sample-guide.md")).toHaveCount(0);
    await expect(page.getByText(/No documents yet/)).toBeVisible();
    expect(deletes).toHaveLength(1);

    await page.reload();
    await expect(page.getByText(/No documents yet/)).toBeVisible();
    const content = await apiGet(request, owner, `${documentsApi(organizationId, projectId)}/${stored.id}/content?download=false`);
    expect(content.status()).toBe(404);
  });
});

test.describe("archive", () => {
  test("an archived project shows an unavailable state and the user stays signed in", async ({ page, request }) => {
    const { owner, organizationId, projectId } = await workspace(request);
    await uploadViaApi(request, owner, organizationId, projectId, "sample-guide.md", fixtureBytes("sample-guide.md"));
    const archived = await request.delete(`/api/v1/organizations/${organizationId}/projects/${projectId}`, { headers: { Authorization: `Bearer ${owner.token}` } });
    expect(archived.status()).toBe(204);

    await signInPage(page, owner);
    await page.goto(documentsPage(organizationId, projectId));
    await expect(page.getByText(/no longer available|archived/i)).toBeVisible();
    await expect(page.getByText("sample-guide.md")).toHaveCount(0);
    await page.goto("/organizations");
    await expect(page).not.toHaveURL(/signin/);
    expect(await page.evaluate(() => localStorage.getItem("tokenscope.accessToken"))).toBe(owner.token);
  });
});

test.describe("failure and cancellation", () => {
  async function ready(page: Page, owner: TestUser, organizationId: string, projectId: string) {
    await signInPage(page, owner);
    await page.goto(documentsPage(organizationId, projectId));
    await fileInput(page).setInputFiles(fixturePath("sample-policy.txt"));
  }

  test("a request interrupted before it reaches the backend shows recovery, reconciles and never repeats the POST", async ({ page, request }) => {
    const { owner, organizationId, projectId } = await workspace(request);
    await page.route(/\/documents$/, route => (route.request().method() === "POST" ? route.abort("connectionreset") : route.continue()));
    const posts = trackRequests(page, "POST", /\/documents$/);
    await ready(page, owner, organizationId, projectId);
    const gets = trackRequests(page, "GET", /\/documents$/);

    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByText(/may or may not have been saved/)).toBeVisible();
    await expect.poll(() => gets.length).toBeGreaterThan(0); // The list was re-read.
    await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeEnabled(); // A deliberate new attempt is possible.
    expect(posts).toHaveLength(1);
    await expect(page.getByText(/No documents yet/)).toBeVisible(); // Nothing was stored, and it says so.
  });

  test("cancelling a controlled in-progress upload explains the uncertainty and reconciles without a repeat", async ({ page, request }) => {
    const { owner, organizationId, projectId } = await workspace(request);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(/\/documents$/, async route => {
      if (route.request().method() !== "POST") return route.continue();
      await held;
      await route.abort();
    });
    const posts = trackRequests(page, "POST", /\/documents$/);
    await ready(page, owner, organizationId, projectId);
    const gets = trackRequests(page, "GET", /\/documents$/);

    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByRole("progressbar", { name: "Upload progress" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel upload" }).click();
    await expect(page.getByText(/Upload cancelled\. If the server had already finished saving the file, it may still appear/)).toBeVisible();
    await expect.poll(() => gets.length).toBeGreaterThan(0);
    expect(posts).toHaveLength(1);
    release();
  });
});

test.describe("navigation", () => {
  test("a download still in flight when the user switches project never starts in the new project", async ({ page, request }) => {
    const { owner, organizationId, projectId } = await workspace(request);
    const secondProjectId = await createProject(request, owner, organizationId, "Second project");
    await uploadViaApi(request, owner, organizationId, projectId, "sample-brief.pdf", fixtureBytes("sample-brief.pdf"));
    await uploadViaApi(request, owner, organizationId, secondProjectId, "sample-policy.txt", fixtureBytes("sample-policy.txt"));
    await signInPage(page, owner);

    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(/\/content\?download=true$/, async route => {
      await held;
      await route.continue().catch(() => undefined); // The browser may already have cancelled this request.
    });
    const downloads: string[] = [];
    page.on("download", download => downloads.push(download.suggestedFilename()));
    const cancelled: string[] = [];
    page.on("requestfailed", request => { if (/\/content\?download=true$/.test(request.url())) cancelled.push(request.failure()?.errorText ?? ""); });

    await page.goto(documentsPage(organizationId, projectId));
    await rowAction(page, "Download", "sample-brief.pdf").click();
    // Client-side navigation to the other project while the content request is pending.
    await page.getByRole("button", { name: "Projects" }).click();
    await page.getByRole("link", { name: "Second project" }).click();
    await page.getByRole("link", { name: "Documents", exact: true }).click();
    await expect(rowAction(page, "Preview", "sample-policy.txt")).toBeVisible();

    // Leaving the page aborts the pending retrieval: the browser reports the request as cancelled.
    await expect.poll(() => cancelled.length).toBe(1);
    release();
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300))); // Let any late handler run.
    expect(downloads).toHaveLength(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("sample-brief.pdf")).toHaveCount(0);
  });
});


for (const loss of ["membership", "project", "organization"] as const) {
  test(`an open private preview is cleared after ${loss} access loss`, async ({ browser, baseURL, request }) => {
    const { owner, organizationId, projectId } = await workspace(request);
    const member = await signUp(request, "revoked-member");
    await addMember(request, owner, organizationId, member, "MEMBER");
    const stored = await uploadViaApi(request, owner, organizationId, projectId,
      "private.txt", Buffer.from("Private document for the access-loss test."));
    const context = await signedInContext(browser, baseURL, member);
    try {
      const page = await context.newPage();
      await page.goto(documentsPage(organizationId, projectId));
      await rowAction(page, "Preview", "private.txt").click();
      await expect(page.getByRole("dialog").getByText("Private document for the access-loss test.")).toBeVisible();
      const headers = { Authorization: `Bearer ${owner.token}` };
      if (loss === "membership") {
        const me = await apiGet(request, member, "/api/v1/auth/me");
        expect(me.status()).toBe(200);
        const user = await me.json();
        expect((await request.delete(`/api/v1/organizations/${organizationId}/members/${user.id}`, { headers })).status()).toBe(204);
      } else if (loss === "project") {
        expect((await request.delete(`/api/v1/organizations/${organizationId}/projects/${projectId}`, { headers })).status()).toBe(204);
      } else {
        const organization = await apiGet(request, owner, `/api/v1/organizations/${organizationId}`);
        expect(organization.status()).toBe(200);
        const { slug } = await organization.json();
        expect((await request.delete(`/api/v1/organizations/${organizationId}`, { headers, data: { confirmSlug: slug } })).status()).toBe(204);
      }
      // No reload: the existing shared realtime client delivers the access change.
      await expect(page.getByText("This project is no longer available.")).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByText("private.txt", { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem("tokenscope.accessToken"))).toBe(member.token);
      expect((await apiGet(request, member,
        `${documentsApi(organizationId, projectId)}/${stored.id}/content`)).status()).toBe(404);
      expect((await apiGet(request, member, "/api/v1/auth/me")).status()).toBe(200);
    } finally {
      await context.close();
    }
  });
}
