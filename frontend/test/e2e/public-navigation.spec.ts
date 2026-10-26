import { test, expect, type Page } from "@playwright/test";
import { createOrganization, createProject, signInPage, signUp } from "./helpers";

async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

// Real built pages; only the deliberately unavailable auth endpoint is intercepted.
for (const [path, title] of [["/privacy", "Privacy Policy"], ["/terms", "Terms of Service"]]) {
  test(`${title} survives invalid storage, unavailable API and direct refresh`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.addInitScript(() => localStorage.setItem("tokenscope.accessToken", "invalid-test-token"));
    let apiCalls = 0;
    // Block backend requests without blocking Vite's /src/api/ modules.
    await page.route(
      url => url.pathname.startsWith("/api/v1/"),
      route => {
        apiCalls += 1;
        return route.abort();
      },
    );
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page).toHaveTitle(`${title} — tokenscope`);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    expect(apiCalls).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem("tokenscope.accessToken"))).toBe("invalid-test-token");
    await noPageOverflow(page);
    expect(errors).toEqual([]);
  });
}

for (const path of ["/", "/signin", "/signup"]) {
  test(`legal links work from ${path}`, async ({ page }) => {
    await page.goto(path);
    const links = page.getByRole("navigation", { name: "Legal information" });
    await links.getByRole("link", { name: "Privacy Policy" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
    await page.getByRole("navigation", { name: "Legal information" }).getByRole("link", { name: "Terms of Service" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeVisible();
  });
}

test("a session failure can open legal pages and returning resumes authentication", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tokenscope.accessToken", "existing-test-token"));
  let checks = 0;
  await page.route("**/api/v1/auth/me", route => { checks += 1; return route.abort(); });
  await page.goto("/organizations");
  await expect(page.getByRole("heading", { name: "Unable to verify your session" })).toBeVisible();
  const before = checks;
  await page.getByRole("link", { name: "Privacy Policy" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
  expect(checks).toBe(before);
  await page.getByRole("link", { name: "Back to home" }).click();
  await expect(page.getByRole("heading", { name: "Unable to verify your session" })).toBeVisible();
  expect(checks).toBeGreaterThan(before);
});

for (const [colorScheme, fill] of [["light", "rgb(17, 24, 39)"], ["dark", "rgb(248, 250, 252)"]] as const) {
  test(`the standalone SVG favicon adapts to ${colorScheme} browser chrome`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]'))
      .toHaveAttribute("href", "/logo/favicon.svg");
    // Inspect the standalone asset, not the page's <img> with dark:invert.
    const response = await page.goto("/logo/favicon.svg");
    expect(response?.ok()).toBe(true);
    await expect(page.locator("svg g")).toHaveCSS("fill", fill);
  });
}

test("theme toggles persist across public navigation and reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("link", { name: "Privacy Policy" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("mobile navigation supports keyboard, switching, resizing and existing project destinations", async ({ page, request }) => {
  const owner = await signUp(request, "navigation");
  const org = await createOrganization(request, owner);
  const project = await createProject(request, owner, org, "Navigation project");
  await signInPage(page, owner);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/organizations/${org}/projects/${project}`);
  await expect(page.getByRole("heading", { name: "Navigation project" })).toBeVisible();
  const open = page.getByRole("button", { name: "Open menu" });
  await open.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(drawer).toBeVisible();
  await expect.poll(() => drawer.evaluate(element => element.contains(document.activeElement))).toBe(true);
  // A modal drawer must keep keyboard focus inside, including at its bounds.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");

    // Base UI redirects focus from its boundary guard on the next frame.
    await expect.poll(
      () =>
        drawer.evaluate(element =>
          element.contains(document.activeElement)
        ),
      { message: `Focus should stay inside the drawer after Tab ${i + 1}` },
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(open).toBeFocused();
  await open.click();
  await drawer.getByRole("link", { name: "Members", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/organizations/${org}/members$`));
  await expect(drawer).not.toBeVisible();
  // Nested organization menu must work inside the modal navigation.
  await open.click();
  await drawer.getByRole("button", { name: "Choose organization" }).click();
  await page.getByRole("menuitem", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/organizations$/);
  await expect(drawer).not.toBeVisible();
  await page.getByLabel("Organization name", { exact: true }).fill("Preserved navigation draft");
  await open.click();
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole("complementary", { name: "Workspace navigation" })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await noPageOverflow(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByLabel("Organization name", { exact: true })).toHaveValue("Preserved navigation draft");
  await expect(drawer).not.toBeVisible();
  await noPageOverflow(page);
  expect(await page.evaluate(() => localStorage.getItem("tokenscope.accessToken"))).toBe(owner.token);
  // All routes added since PR #40 remain reachable after the merge.
  const base = `/organizations/${org}/projects/${project}`;
  for (const [suffix, heading] of [["dashboard", "Analytics"], ["traces", "Traces"], ["documents", "Documents"], ["api-keys", "API keys"]]) {
    await page.goto(`${base}/${suffix}`);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await page.getByRole("link", { name: "Privacy Policy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy Policy", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("tokenscope.accessToken"))).toBe(owner.token);
});
