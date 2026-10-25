import { expect, test } from "@playwright/test";

test("browser identity and trusted evaluation HTTPS preflight", async ({ browser, page, request, baseURL }, info) => {
  test.skip(new URL(baseURL!).protocol !== "https:", "HTTP is for development debugging, not evaluation HTTPS evidence.");
  console.log(JSON.stringify({ project: info.project.name, browserVersion: browser.version(), origin: new URL(baseURL!).origin }));
  const errors: string[] = [];
  page.on("pageerror", () => errors.push("uncaught page error"));
  page.on("console", message => { if (message.type() === "error") errors.push("console error"); });
  page.on("requestfailed", () => errors.push("failed request"));
  page.on("response", response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}`); });
  // Node's API client and the browser must EACH trust the CA.
  const health = await request.get("/api/v1/health/db");
  expect(health.status()).toBe(200);
  const response = await page.goto("/privacy");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Privacy Policy", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  expect(errors).toEqual([]);
});
