import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Throwaway data: unique per run, never a real account or key.
const RUN = Date.now().toString(36);
const PASSWORD = "E2e-demo-password-2026";
const TOKEN_KEY = "tokenscope.accessToken";

type Actor = { token: string; id: string; email: string };
type Workspace = {
  owner: Actor; admin: Actor; member: Actor; outsider: Actor;
  orgId: string; projectId: string;
};

let api: APIRequestContext;
let ws: Workspace;

const auth = (actor: Actor) => ({ Authorization: "Bearer " + actor.token });
const keysUrl = (orgId: string, projectId: string) =>
  "/organizations/" + orgId + "/projects/" + projectId + "/api-keys";
const keysApi = (orgId: string, projectId: string) =>
  "/api/v1/organizations/" + orgId + "/projects/" + projectId + "/api-keys";
const KEYS_POST = "**/api/v1/organizations/*/projects/*/api-keys";

async function signUp(name: string): Promise<Actor> {
  const email = "e2e." + name + "." + RUN + "@tokenscope.dev";
  const response = await api.post("/api/v1/auth/signup", {
    data: { email, password: PASSWORD, displayName: name },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  return { token: body.accessToken, id: body.user.id, email };
}

async function createOrg(owner: Actor, name: string): Promise<string> {
  const response = await api.post("/api/v1/organizations", {
    headers: auth(owner), data: { name },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}

async function createProject(owner: Actor, orgId: string, name: string): Promise<string> {
  const response = await api.post("/api/v1/organizations/" + orgId + "/projects", {
    headers: auth(owner), data: { name, description: "E2E" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}

async function addMember(owner: Actor, orgId: string, who: Actor, role: "ADMIN" | "MEMBER") {
  const response = await api.post("/api/v1/organizations/" + orgId + "/members", {
    headers: auth(owner), data: { email: who.email, role },
  });
  expect(response.status()).toBe(201);
}

async function listKeys(actor: Actor, orgId: string, projectId: string) {
  const response = await api.get(keysApi(orgId, projectId), { headers: auth(actor) });
  expect(response.status()).toBe(200);
  return (await response.json()) as Array<{ id: string; name: string; revokedAt: string | null }>;
}

async function createKeyApi(actor: Actor, orgId: string, projectId: string, name: string) {
  const response = await api.post(keysApi(orgId, projectId), {
    headers: auth(actor), data: { name },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; key: string };
}

async function signIn(page: Page, actor: Actor) {
  await page.addInitScript(
    ([key, token]) => localStorage.setItem(key, token),
    [TOKEN_KEY, actor.token],
  );
}

// Real sign-in through the form, used once in the main journey.
async function signInThroughUi(page: Page, actor: Actor) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(actor.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/organizations/);
}

// Records matching requests so a test can prove nothing was sent.
function track(page: Page, match: (method: string, url: string) => boolean) {
  const seen: string[] = [];
  page.on("request", request => {
    if (match(request.method(), request.url())) {
      seen.push(request.method() + " " + new URL(request.url()).pathname);
    }
  });
  return seen;
}

// Booleans only: a failing assertion must never print the secret.
async function expectNoSecret(page: Page, secret: string) {
  const html = await page.content();
  const text = await page.locator("body").innerText();
  const storage = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(html.includes(secret), "secret in page HTML").toBe(false);
  expect(text.includes(secret), "secret in page text").toBe(false);
  expect(storage.includes(secret), "secret in browser storage").toBe(false);
  expect(page.url().includes(secret), "secret in URL").toBe(false);
}

async function createKeyInUi(page: Page, name: string) {
  await page.getByRole("button", { name: "Create API key" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create key" }).click();
}

test.beforeAll(async ({ playwright }, testInfo) => {
  api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  const owner = await signUp("owner");
  const admin = await signUp("admin");
  const member = await signUp("member");
  const outsider = await signUp("outsider");
  const orgId = await createOrg(owner, "E2E Keys " + RUN);
  await addMember(owner, orgId, admin, "ADMIN");
  await addMember(owner, orgId, member, "MEMBER");
  const projectId = await createProject(owner, orgId, "Main " + RUN);
  ws = { owner, admin, member, outsider, orgId, projectId };
});

test.afterAll(async () => {
  await api.dispose();
});

test("OWNER sees the empty state on a new project", async ({ page }) => {
  const projectId = await createProject(ws.owner, ws.orgId, "Empty " + RUN);
  await signIn(page, ws.owner);
  await page.goto(keysUrl(ws.orgId, projectId));

  await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();
  await expect(page.getByText("No API keys yet.")).toBeVisible();
});

test("OWNER creates a key, sees the secret once, then revokes it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signInThroughUi(page, ws.owner);
  const name = "Journey " + RUN;
  await page.goto(keysUrl(ws.orgId, ws.projectId));
  await createKeyInUi(page, name);

  const box = page.getByRole("textbox", { name: "API key" });
  await expect(box).toBeVisible();
  const secret = await box.inputValue();
  expect(secret.startsWith("tsk_"), "key has the tsk_ format").toBe(true);

  await page.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByText("Copied to clipboard.")).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard === secret, "clipboard holds the full key").toBe(true);

  await page.getByRole("button", { name: "I have saved this key" }).click();
  await expect(box).toHaveCount(0);
  await expectNoSecret(page, secret);

  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row).toContainText("Active");
  const prefix = (await row.locator("code").innerText()).replace("…", "");
  expect(secret.startsWith(prefix), "the list shows only the prefix").toBe(true);

  await page.reload();
  await expect(row).toBeVisible();
  await expectNoSecret(page, secret);

  const listResponse = await api.get(keysApi(ws.orgId, ws.projectId), { headers: auth(ws.owner) });
  expect(listResponse.headers()["cache-control"]).toContain("no-store");
  expect((await listResponse.text()).includes(secret), "list endpoint leaks the key").toBe(false);

  // Cancel sends nothing.
  const deletes = track(page, method => method === "DELETE");
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("Revoke this key?")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Revoke this key?")).toBeHidden();
  expect(deletes).toHaveLength(0);

  // Confirm revokes once.
  await row.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("button", { name: "Revoke key" }).click();
  await expect(row).toContainText("Revoked");
  await expect(row.getByRole("button", { name: "Revoke" })).toHaveCount(0);
  expect(deletes).toHaveLength(1);

  const stored = (await listKeys(ws.owner, ws.orgId, ws.projectId)).find(key => key.name === name);
  expect(stored?.revokedAt).not.toBeNull();
});

test.fixme(
  "a fresh key creates a public trace; after revocation the same key gets 401 INVALID_API_KEY",
  async () => {
    // Blocked until the public trace routes (TSE-68/69) are merged into develop.
  },
);

test("ADMIN can create and revoke keys", async ({ page }) => {
  await signIn(page, ws.admin);
  const name = "Admin " + RUN;
  await page.goto(keysUrl(ws.orgId, ws.projectId));
  await createKeyInUi(page, name);
  await page.getByRole("button", { name: "I have saved this key" }).click();

  const row = page.getByRole("listitem").filter({ hasText: name });
  await row.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("button", { name: "Revoke key" }).click();
  await expect(row).toContainText("Revoked");
});

test("MEMBER is denied: no link, no controls, no key list request", async ({ page }) => {
  await signIn(page, ws.member);
  const seen = track(page, (_method, url) => new URL(url).pathname.startsWith("/api/v1/") && url.includes("/api-keys"));

  await page.goto("/organizations/" + ws.orgId + "/projects/" + ws.projectId);
  await expect(page.getByRole("heading", { name: "Main " + RUN })).toBeVisible();
  await expect(page.getByRole("link", { name: "API keys" })).toHaveCount(0);

  await page.goto(keysUrl(ws.orgId, ws.projectId));
  await expect(page.getByText(/do not have permission/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create API key" })).toHaveCount(0);
  expect(seen).toHaveLength(0);

  // The backend stays authoritative: direct management requests are refused.
  const list = await api.get(keysApi(ws.orgId, ws.projectId), { headers: auth(ws.member) });
  expect(list.status()).toBe(403);
  expect((await list.json()).code).toBe("INSUFFICIENT_ORGANIZATION_ROLE");
  const create = await api.post(keysApi(ws.orgId, ws.projectId), {
    headers: auth(ws.member), data: { name: "Denied " + RUN },
  });
  expect(create.status()).toBe(403);
});

test("OWNER reaches the page from the project detail link", async ({ page }) => {
  await signIn(page, ws.owner);
  await page.goto("/organizations/" + ws.orgId + "/projects/" + ws.projectId);
  await page.getByRole("link", { name: "API keys" }).click();
  await expect(page).toHaveURL(new RegExp(keysUrl(ws.orgId, ws.projectId) + "$"));
  await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();
});

test("an outsider gets not-found and no data", async ({ page }) => {
  await createKeyApi(ws.owner, ws.orgId, ws.projectId, "Hidden " + RUN);
  await signIn(page, ws.outsider);
  await page.goto(keysUrl(ws.orgId, ws.projectId));

  await expect(page.getByText("Project not found.")).toBeVisible();
  await expect(page.getByText("Hidden " + RUN)).toHaveCount(0);
  const response = await api.get(keysApi(ws.orgId, ws.projectId), { headers: auth(ws.outsider) });
  expect(response.status()).toBe(404);
});

test("keys are isolated between two projects of the same organization", async ({ page }) => {
  const other = await createProject(ws.owner, ws.orgId, "Other " + RUN);
  const created = await createKeyApi(ws.owner, ws.orgId, ws.projectId, "Isolated " + RUN);

  await signIn(page, ws.owner);
  await page.goto(keysUrl(ws.orgId, other));
  await expect(page.getByText("No API keys yet.")).toBeVisible();
  await expect(page.getByText("Isolated " + RUN)).toHaveCount(0);

  const response = await api.delete(keysApi(ws.orgId, other) + "/" + created.id, {
    headers: auth(ws.owner),
  });
  expect(response.status()).toBe(404);
  expect((await response.json()).code).toBe("API_KEY_NOT_FOUND");
  const stillActive = (await listKeys(ws.owner, ws.orgId, ws.projectId))
    .find(key => key.id === created.id);
  expect(stillActive?.revokedAt).toBeNull();
});

test("an archived project is not found and requests no key list", async ({ page }) => {
  const projectId = await createProject(ws.owner, ws.orgId, "Archived " + RUN);
  const archive = await api.delete("/api/v1/organizations/" + ws.orgId + "/projects/" + projectId, {
    headers: auth(ws.owner),
  });
  expect(archive.ok()).toBe(true);

  await signIn(page, ws.owner);
  const seen = track(page, (_method, url) => new URL(url).pathname.startsWith("/api/v1/") && url.includes("/api-keys"));
  await page.goto(keysUrl(ws.orgId, projectId));

  await expect(page.getByText("Project not found.")).toBeVisible();
  expect(seen).toHaveLength(0);
  const response = await api.get(keysApi(ws.orgId, projectId), { headers: auth(ws.owner) });
  expect(response.ok(), "key list of an archived project").toBe(false);
});

test("a name that is empty or too long sends nothing", async ({ page }) => {
  await signIn(page, ws.owner);
  const posts = track(page, method => method === "POST");
  await page.goto(keysUrl(ws.orgId, ws.projectId));

  await createKeyInUi(page, "   ");
  await expect(page.getByText("Use a name of 1–64 characters.")).toBeVisible();
  await page.getByLabel("Name").fill("x".repeat(65));
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByText("Use a name of 1–64 characters.")).toBeVisible();
  expect(posts).toHaveLength(0);
});

test("a response arriving after switching project never shows the secret", async ({ page }) => {
  const other = await createProject(ws.owner, ws.orgId, "Switch " + RUN);
  const name = "Late " + RUN;
  let secret = "";
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });

  await page.route(KEYS_POST, async route => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    secret = (await response.json()).key;
    await gate; // hold the 201 until the user is on another project
    await route.fulfill({ response });
  });

  await signIn(page, ws.owner);
  await page.goto(keysUrl(ws.orgId, ws.projectId));
  await createKeyInUi(page, name);
  await expect(page.getByRole("button", { name: "Creating…" })).toBeVisible();
  await expect.poll(() => secret !== "").toBe(true);

  // In-app navigation, like the browser back button: the SPA stays loaded.
  await page.evaluate(path => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, keysUrl(ws.orgId, other));
  await expect(page.getByText("No API keys yet.")).toBeVisible();

  release();
  await page.waitForTimeout(300); // let the late response be processed
  await expect(page.getByRole("textbox", { name: "API key" })).toHaveCount(0);
  await expectNoSecret(page, secret);

  // The key exists on the server but was never shown anywhere.
  const stored = (await listKeys(ws.owner, ws.orgId, ws.projectId)).find(key => key.name === name);
  expect(stored).toBeDefined();
});

test("a network failure on creation never repeats the POST", async ({ page }) => {
  const name = "Offline " + RUN;
  await signIn(page, ws.owner);
  await page.route(KEYS_POST, route =>
    route.request().method() === "POST" ? route.abort("failed") : route.continue());
  const posts = track(page, method => method === "POST");
  await page.goto(keysUrl(ws.orgId, ws.projectId));

  await createKeyInUi(page, name);

  await expect(page.getByText(/may or may not have been created/)).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(await page.getByRole("textbox", { name: "API key" }).count()).toBe(0);
  const stored = (await listKeys(ws.owner, ws.orgId, ws.projectId)).find(key => key.name === name);
  expect(stored).toBeUndefined();
});

test("a 429 on revocation keeps the dialog open and does not retry", async ({ page }) => {
  const name = "Limited " + RUN;
  const created = await createKeyApi(ws.owner, ws.orgId, ws.projectId, name);
  await signIn(page, ws.owner);
  await page.route("**/api-keys/*", route =>
    route.request().method() === "DELETE"
      ? route.fulfill({
          status: 429,
          headers: { "Retry-After": "30" },
          json: { code: "RATE_LIMITED", message: "Slow down." },
        })
      : route.continue());
  const deletes = track(page, method => method === "DELETE");
  await page.goto(keysUrl(ws.orgId, ws.projectId));

  const row = page.getByRole("listitem").filter({ hasText: name });
  await row.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("button", { name: "Revoke key" }).click();

  await expect(page.getByText(/Too many requests/)).toBeVisible();
  await expect(page.getByText("Revoke this key?")).toBeVisible();
  expect(deletes).toHaveLength(1);
  const stored = (await listKeys(ws.owner, ws.orgId, ws.projectId)).find(key => key.id === created.id);
  expect(stored?.revokedAt).toBeNull();
});

test("an ADMIN demoted during the session loses the controls and the secret", async ({ page }) => {
  const demoted = await signUp("demoted");
  await addMember(ws.owner, ws.orgId, demoted, "ADMIN");
  await signIn(page, demoted);
  await page.goto(keysUrl(ws.orgId, ws.projectId));
  await page.getByRole("button", { name: "Create API key" }).click();
  await page.getByLabel("Name").fill("Demoted " + RUN);

  const demotion = await api.patch(
    "/api/v1/organizations/" + ws.orgId + "/members/" + demoted.id,
    { headers: auth(ws.owner), data: { role: "MEMBER" } },
  );
  expect(demotion.ok()).toBe(true);

  await page.getByRole("button", { name: "Create key" }).click();

  await expect(page.getByText(/do not have permission/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "API key" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create API key" })).toHaveCount(0);
  const stored = (await listKeys(ws.owner, ws.orgId, ws.projectId))
    .find(key => key.name === "Demoted " + RUN);
  expect(stored).toBeUndefined();
});

test("Escape asks before discarding the secret", async ({ page }) => {
  await signIn(page, ws.owner);
  await page.goto(keysUrl(ws.orgId, ws.projectId));
  await createKeyInUi(page, "Escape " + RUN);
  const field = page.getByRole("textbox", { name: "API key", exact: true });
  await expect(field).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByText("Close without saving?")).toBeVisible();
  await expect(field).toBeVisible();

  await page.getByRole("button", { name: "Keep key visible" }).click();
  await expect(page.getByText("Close without saving?")).toBeHidden();
  await expect(field).toBeVisible();

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Close and discard" }).click();
  await expect(field).toHaveCount(0);
});

test("an outside click asks before discarding the secret", async ({ page }) => {
  await signIn(page, ws.owner);
  await page.goto(keysUrl(ws.orgId, ws.projectId));
  await createKeyInUi(page, "Outside " + RUN);
  const field = page.getByRole("textbox", { name: "API key", exact: true });
  await expect(field).toBeVisible();

  // The corner of the viewport is on the backdrop, outside the dialog.
  await page.mouse.click(5, 5);
  await expect(page.getByText("Close without saving?")).toBeVisible();
  await expect(field).toBeVisible();

  await page.getByRole("button", { name: "Keep key visible" }).click();
  await expect(page.getByText("Close without saving?")).toBeHidden();
  await expect(field).toBeVisible();
});
