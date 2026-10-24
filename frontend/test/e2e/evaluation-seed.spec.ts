import { expect, test } from "@playwright/test";
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

// Passwords and issued tokens must not become automatic browser artifacts.
test.use({ trace: "off", screenshot: "off", video: "off" });

test.describe("real seeded evaluation accounts", () => {
  test.skip(!enabled, "Opt in with E2E_EVALUATION_SEED=1 against an isolated seeded stack.");

  for (const [index, account] of identities.users.entries()) {
    test(`normal sign-in and tenant visibility for account ${index + 1}`, async ({ page }) => {
      await page.goto("/signin");
      await page.getByLabel("Email", { exact: true }).fill(account.email);
      try {
        await page.getByLabel("Password", { exact: true }).fill(password!);
      } catch {
        // Playwright's original fill error can contain the supplied value.
        throw new Error("Unable to enter the evaluation password; sensitive action details omitted.");
      }
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/organizations\/?$/);

      const own = index === 3 ? other : acme;
      const forbidden = index === 3 ? acme : other;
      await expect(page.locator(`a[href="/organizations/${own.id}"]`)).toBeVisible();
      await expect(page.locator(`a[href="/organizations/${forbidden.id}"]`)).toHaveCount(0);
      await page.goto(`/organizations/${own.id}/projects`);
      const allowed = index === 3 ? [isolated] : [golden, empty, pagination];
      for (const project of allowed) {
        await expect(page.locator(`a[href="/organizations/${own.id}/projects/${project.id}"]`)).toBeVisible();
      }
      await expect(page.locator(`a[href="/organizations/${acme.id}/projects/${archived.id}"]`)).toHaveCount(0);

      const blocked = index === 3 ? golden : archived;
      const api = `/api/v1/organizations/${acme.id}/projects/${blocked.id}`;
      const denied = page.waitForResponse(response => new URL(response.url()).pathname === api && response.request().method() === "GET");
      await page.goto(`/organizations/${acme.id}/projects/${blocked.id}`);
      expect((await denied).status()).toBe(404);
      await expect(page.getByText(/^(Project|Organization) not found\.?$/).first()).toBeVisible();
    });
  }
});
