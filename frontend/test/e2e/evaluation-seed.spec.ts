import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const enabled = process.env.E2E_EVALUATION_SEED === "1";
const password = process.env.DEMO_PASSWORD;
if (enabled && !password) throw new Error("DEMO_PASSWORD is required for the opted-in evaluation-seed browser suite.");
const identities = JSON.parse(readFileSync(resolve(__dirname, "../../../fixtures/evaluation/identities.json"), "utf8")) as {
  users: Array<{ id: string; email: string }>;
  organizations: Array<{ id: string }>;
  projects: Array<{ id: string }>;
};
const [acme, other] = identities.organizations;
const [golden, empty, isolated, pagination, archived] = identities.projects;
const analytics = { id: "30000000-0000-4000-8000-000000000006" };
const analyticsExpected = JSON.parse(readFileSync(
  resolve(__dirname, "../../../fixtures/evaluation/analytics-demo/expected-results.json"), "utf8"));

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill(email);
  try {
    await page.getByLabel("Password", { exact: true }).fill(password!);
  } catch {
    throw new Error("Unable to enter the evaluation password; sensitive action details omitted.");
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/organizations\/?$/);
}

// Passwords and issued tokens must not become automatic browser artifacts.
test.use({ trace: "off", screenshot: "off", video: "off" });

test.describe("real seeded evaluation accounts", () => {
  test.skip(!enabled, "Opt in with E2E_EVALUATION_SEED=1 against an isolated seeded stack.");

  for (const [index, account] of identities.users.entries()) {
    test(`normal sign-in and tenant visibility for account ${index + 1}`, async ({ page }) => {
      await signIn(page, account.email);

      const own = index === 3 ? other : acme;
      const forbidden = index === 3 ? acme : other;
      await expect(page.locator(`a[href="/organizations/${own.id}"]`)).toBeVisible();
      await expect(page.locator(`a[href="/organizations/${forbidden.id}"]`)).toHaveCount(0);
      await page.goto(`/organizations/${own.id}/projects`);
      const allowed = index === 3 ? [isolated] : [golden, empty, pagination, analytics];
      for (const project of allowed) {
        await expect(page.locator(`a[href="/organizations/${own.id}/projects/${project.id}"]`)).toBeVisible();
      }
      await expect(page.locator(`a[href="/organizations/${acme.id}/projects/${archived.id}"]`)).toHaveCount(0);

      const blocked = index === 3 ? analytics : archived;
      const api = `/api/v1/organizations/${acme.id}/projects/${blocked.id}`;
      const denied = page.waitForResponse(response => new URL(response.url()).pathname === api && response.request().method() === "GET");
      await page.goto(`/organizations/${acme.id}/projects/${blocked.id}`);
      expect((await denied).status()).toBe(404);
      await expect(page.getByText(/^(Project|Organization) not found\.?$/).first()).toBeVisible();
    });
  }

  test("rich dashboard has twelve models, working filters and no console warnings/errors", async ({ page }) => {
    let consoleProblems = 0;
    let pageErrors = 0;
    let assistantRequests = 0;
    // Count without recording potentially sensitive console contents.
    page.on("console", message => { if (["warning", "error"].includes(message.type())) consoleProblems++; });
    page.on("pageerror", () => { pageErrors++; });
    page.on("request", req => { if (new URL(req.url()).pathname.endsWith("/assistant")) assistantRequests++; });
    await signIn(page, identities.users[0].email);
    // Read the persisted synthetic price start via the normal authenticated API.
    // This keeps the test valid after the original seven-day window becomes old.
    const from = await page.evaluate(async () => {
      const token = localStorage.getItem("tokenscope.accessToken");
      const response = await fetch("/api/v1/model-prices?provider=demo-aurora&model=aurora-mini", {
        headers: { Authorization: "Bearer " + token },
      });
      if (!response.ok) throw new Error("Unable to read the evaluation price window.");
      const rows = await response.json() as Array<{ id: string; effectiveFrom: string }>;
      const price = rows.find(row => row.id === "40000000-0000-4000-8000-000000001001");
      if (!price) throw new Error("The analytics demo price catalogue is not installed.");
      return price.effectiveFrom;
    });
    const to = new Date(Date.parse(from) + 7 * 86_400_000).toISOString();
    const path = "/organizations/" + acme.id + "/projects/" + analytics.id;
    const api = "/api/v1" + path + "/analytics";
    const initial = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === api && url.searchParams.get("from") === from &&
        url.searchParams.get("to") === to && !url.searchParams.has("provider") && response.status() === 200;
    });
    await page.goto(path + "?" + new URLSearchParams({ from, to }));
    expect((await (await initial).json()).summary).toEqual(analyticsExpected.baseline);
    await expect(page.getByRole("heading", { name: "Analytics Demo", exact: true })).toBeVisible();
    await expect(page.getByTestId("metric").filter({ has: page.getByText("Traces", { exact: true }) })).toContainText("840");
    const modelChart = page.locator('section[aria-label="Cost by provider and model"]');
    await modelChart.getByRole("button", { name: "Show data table", exact: true }).click();
    await expect(modelChart.getByRole("row")).toHaveCount(13);

    const filtered = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === api && url.searchParams.get("provider") === "demo-boreal" &&
        url.searchParams.get("model") === "boreal-pro" && response.status() === 200;
    });
    await page.getByLabel("Provider", { exact: true }).selectOption("demo-boreal");
    await page.getByLabel("Model", { exact: true }).selectOption("boreal-pro");
    expect((await (await filtered).json()).summary).toEqual(analyticsExpected.byModel["demo-boreal/boreal-pro"]);
    await expect(page.getByTestId("metric").filter({ has: page.getByText("Traces", { exact: true }) })).toContainText("38");
    expect(pageErrors, "Unhandled browser errors").toBe(0);
    expect(consoleProblems, "Browser console warnings/errors").toBe(0);
    expect(assistantRequests, "Analytics must not invoke the LLM").toBe(0);
  });
});
