import { expect, test, type Page } from "@playwright/test";
import { addMember, createOrganization, createProject, signUp, TEST_PASSWORD } from "./helpers";

async function sectionLink(page: Page, name: string) {
  const trigger = page.getByRole("button", { name: "Open menu" });
  if (await trigger.isVisible()) await trigger.click();
  return page.getByRole("group", { name: "Project sections" }).getByRole("link", { name, exact: true });
}

async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const main = document.querySelector("main")!;
    return document.documentElement.scrollWidth <= innerWidth + 1 && main.scrollWidth <= main.clientWidth + 1;
  })).toBe(true);
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test.describe(`project Settings at ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
      test(`${role}: sidebar navigation and project settings permissions`, async ({ page, request }) => {
        const owner = await signUp(request, "settings-owner");
        const org = await createOrganization(request, owner);
        const actor = role === "OWNER" ? owner : await signUp(request, `settings-${role}`);
        if (role !== "OWNER") await addMember(request, owner, org, actor, role);
        const id = await createProject(request, owner, org, "Settings " + "W".repeat(90));
        const base = `/organizations/${org}/projects/${id}`;
        const faults: string[] = [];
        // Never record request bodies, tokens, full URLs or console text.
        page.on("pageerror", () => faults.push("uncaught page error"));
        page.on("console", message => { if (message.type() === "error") faults.push("console error"); });
        page.on("response", response => {
          if (new URL(response.url()).pathname.startsWith("/api/v1/") && response.status() >= 400) {
            faults.push(`unexpected HTTP ${response.status()}`);
          }
        });
        page.on("requestfailed", req => {
          // Route changes deliberately cancel obsolete reads; exceptions still fail via pageerror.
          if (req.method() === "GET" && /^(net::ERR_ABORTED|NS_BINDING_ABORTED)$/.test(req.failure()?.errorText ?? "")) return;
          if (new URL(req.url()).origin === new URL(test.info().project.use.baseURL!).origin) faults.push("failed application request");
        });

        await page.goto("/signin");
        await page.getByLabel("Email", { exact: true }).fill(actor.email);
        await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await expect(page).toHaveURL(/\/organizations\/?$/);
        await page.goto(`${base}/settings`);
        await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
        await noOverflow(page);

        if (role === "MEMBER") {
          await expect(page.getByText("Only organization owners and admins can change project settings.")).toBeVisible();
          await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
          await expect(page.getByRole("button", { name: "Archive project", exact: true })).toHaveCount(0);
          const overview = await sectionLink(page, "Overview");
          await expect(page.getByRole("group", { name: "Project sections" }).getByRole("link", { name: /^(Settings|API keys)$/ })).toHaveCount(0);
          await overview.click();
          await expect(page.getByText("Description: No description yet.")).toBeVisible();
        } else {
          await page.getByRole("button", { name: "Edit", exact: true }).click();
          const dialog = page.getByRole("dialog", { name: "Edit project" });
          await dialog.getByLabel("Name", { exact: true }).fill("Renamed settings project");
          await dialog.getByLabel("Description", { exact: true }).fill("Still readable from Overview.");
          await dialog.getByRole("button", { name: "Save", exact: true }).click();
          await expect(dialog).toHaveCount(0);
          await expect(page.getByRole("heading", { name: "Renamed settings project", exact: true })).toBeVisible();
          await (await sectionLink(page, "Overview")).click();
          await expect(page.getByText("Description: Still readable from Overview.")).toBeVisible();
          await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
          for (const name of ["Traces", "Documents", "API keys", "Settings"]) {
            await (await sectionLink(page, name)).click();
            await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
          }
          await page.reload();
          await expect(page.getByRole("heading", { name: "Renamed settings project", exact: true })).toBeVisible();
          await noOverflow(page);
          page.once("dialog", dialog => dialog.accept());
          await page.getByRole("button", { name: "Archive project", exact: true }).click();
          await expect(page).toHaveURL(`/organizations/${org}/projects`);
          await expect(page.getByRole("link", { name: "Renamed settings project", exact: true })).toHaveCount(0);
        }
        expect(faults, "Unexpected application diagnostics (sensitive contents omitted)").toEqual([]);
      });
    }
  });
}
