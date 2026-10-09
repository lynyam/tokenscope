import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

// Every run creates its own disposable accounts and organizations.
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = "E2e-Passw0rd!2026";
let sequence = 0;
const unique = (label: string) => `${label}-${run}-${++sequence}`;

interface Account { email: string; id: string; token: string; }
interface Org { id: string; name: string; slug: string; }

const auth = (account: Account) => ({ Authorization: `Bearer ${account.token}` });

async function signUp(request: APIRequestContext, label: string): Promise<Account> {
  const email = `${unique(label)}@e2e.tokenscope.test`;
  const response = await request.post("/api/v1/auth/signup", {
    data: { email, password, displayName: `${label} ${run}` },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return { email, id: body.user.id, token: body.accessToken };
}

async function createOrganization(
  request: APIRequestContext, owner: Account, label: string,
): Promise<Org> {
  const response = await request.post("/api/v1/organizations", {
    headers: auth(owner), data: { name: `E2E ${unique(label)}` },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function addMember(
  request: APIRequestContext, owner: Account, org: Org,
  account: Account, role: "ADMIN" | "MEMBER",
) {
  const response = await request.post(`/api/v1/organizations/${org.id}/members`, {
    headers: auth(owner), data: { email: account.email, role },
  });
  expect(response.ok()).toBeTruthy();
}

async function signInThroughUi(page: Page, account: Account) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/organizations$/);
}

async function signedInPage(browser: Browser, account: Account) {
  // browser.newContext() does not inherit the configured baseURL.
  const baseURL = test.info().project.use.baseURL;
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await signInThroughUi(page, account);
  return { page, context };
}

async function openDeleteDialog(page: Page) {
  await page.getByRole("button", { name: "Delete organization" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function deleteThroughDialog(page: Page, org: Org) {
  const dialog = await openDeleteDialog(page);
  const input = dialog.getByLabel("Organization slug");
  await input.fill(org.slug);
  await input.press("Enter"); // Keyboard confirmation.
  await expect(page).toHaveURL(/\/organizations$/);
}

test.describe("Organization soft archive", () => {
  test("OWNER cancels, reopens, confirms with the keyboard, and the organization disappears", async ({ page, request }) => {
    const owner = await signUp(request, "owner");
    const org = await createOrganization(request, owner, "delete");
    await signInThroughUi(page, owner);
    await page.goto(`/organizations/${org.id}`);

    // The dialog shows the name and the exact slug.
    let dialog = await openDeleteDialog(page);
    await expect(dialog.getByText(org.name, { exact: true })).toBeVisible();
    await expect(dialog.getByText(org.slug, { exact: true })).toBeVisible();

    // Cancel sends no request and clears the typed value.
    await dialog.getByLabel("Organization slug").fill(org.slug);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    dialog = await openDeleteDialog(page);
    await expect(dialog.getByLabel("Organization slug")).toHaveValue("");
    const confirm = dialog.getByRole("button", { name: "Delete organization" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Organization slug").fill(org.slug.toUpperCase() + "x");
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Organization slug").fill(org.slug);
    await expect(confirm).toBeEnabled();
    await dialog.getByLabel("Organization slug").press("Enter");

    // After navigation: gone from the list and the switcher.
    await expect(page).toHaveURL(/\/organizations$/);
    await expect(page.getByRole("heading", { name: "Organizations" })).toBeVisible();
    await expect(page.getByText(org.name, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Choose organization" }).click();
    await expect(page.getByRole("menu").getByText("No organizations yet.")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: org.name })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // The archive persists after a reload, and the session stays alive.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Organizations" })).toBeVisible();
    await expect(page.getByText(org.name, { exact: true })).toHaveCount(0);
    await page.goto(`/organizations/${org.id}`);
    await expect(page.getByRole("main").getByText("Organization not found")).toBeVisible();
  });

  test("ADMIN and MEMBER cannot delete; an outsider gets 404", async ({ browser, request }) => {
    const owner = await signUp(request, "owner");
    const admin = await signUp(request, "admin");
    const member = await signUp(request, "member");
    const outsider = await signUp(request, "outsider");
    const org = await createOrganization(request, owner, "roles");
    await addMember(request, owner, org, admin, "ADMIN");
    await addMember(request, owner, org, member, "MEMBER");

    for (const [account, role] of [[admin, "ADMIN"], [member, "MEMBER"]] as const) {
      const { page, context } = await signedInPage(browser, account);
      try {
        await page.goto(`/organizations/${org.id}`);
        await expect(page.getByText(role, { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Delete organization" })).toHaveCount(0);
      } finally {
        await context.close();
      }

      // A direct authenticated DELETE is refused, even with the right slug.
      const response = await request.delete(`/api/v1/organizations/${org.id}`, {
        headers: auth(account), data: { confirmSlug: org.slug },
      });
      expect(response.status()).toBe(403);
      expect((await response.json()).code).toBe("INSUFFICIENT_ORGANIZATION_ROLE");
    }

    const concealed = await request.delete(`/api/v1/organizations/${org.id}`, {
      headers: auth(outsider), data: { confirmSlug: org.slug },
    });
    expect(concealed.status()).toBe(404);
    expect((await concealed.json()).code).toBe("ORGANIZATION_NOT_FOUND");

    // Nothing was archived.
    const still = await request.get(`/api/v1/organizations/${org.id}`, {
      headers: auth(owner),
    });
    expect(still.status()).toBe(200);
  });

  test("a member who had the organization open loses access but stays signed in", async ({ browser, page, request }) => {
    const owner = await signUp(request, "owner");
    const member = await signUp(request, "member");
    const org = await createOrganization(request, owner, "second-browser");
    await addMember(request, owner, org, member, "MEMBER");

    const { page: memberPage, context } = await signedInPage(browser, member);
    try {
      await memberPage.goto(`/organizations/${org.id}`);
      await expect(memberPage.getByRole("main").getByText(org.name, { exact: true })).toBeVisible();

      // The OWNER deletes it from another browser context.
      await signInThroughUi(page, owner);
      await page.goto(`/organizations/${org.id}`);
      await deleteThroughDialog(page, org);

      // On the member's next request or reload, access is lost.
      await memberPage.reload();
      await expect(memberPage.getByRole("main").getByText("Organization not found")).toBeVisible();

      // The member is still authenticated and can use the application.
      await memberPage.goto("/organizations");
      await expect(memberPage.getByRole("heading", { name: "Organizations" })).toBeVisible();
      await expect(memberPage.getByText(org.name, { exact: true })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("an interrupted DELETE keeps the dialog and input, and a real retry succeeds", async ({ page, request }) => {
    const owner = await signUp(request, "owner");
    const org = await createOrganization(request, owner, "recovery");
    await signInThroughUi(page, owner);
    await page.goto(`/organizations/${org.id}`);

    // Fault injection is limited to the first DELETE, which never reaches the backend.
    let interrupted = false;
    await page.route(`**/api/v1/organizations/${org.id}`, async route => {
      if (route.request().method() === "DELETE" && !interrupted) {
        interrupted = true;
        await route.abort("connectionreset");
        return;
      }
      await route.continue();
    });

    const dialog = await openDeleteDialog(page);
    const input = dialog.getByLabel("Organization slug");
    await input.fill(org.slug);
    await dialog.getByRole("button", { name: "Delete organization" }).click();

    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(input).toHaveValue(org.slug);
    await expect(page).toHaveURL(new RegExp(`/organizations/${org.id}$`));

    // The first request did not reach the server: the organization is still active.
    const stillActive = await request.get(`/api/v1/organizations/${org.id}`, {
      headers: auth(owner),
    });
    expect(stillActive.status()).toBe(200);

    // A deliberate retry goes through the real API.
    await dialog.getByRole("button", { name: "Delete organization" }).click();
    await expect(page).toHaveURL(/\/organizations$/);
    const archived = await request.get(`/api/v1/organizations/${org.id}`, {
      headers: auth(owner),
    });
    expect(archived.status()).toBe(404);
  });
});