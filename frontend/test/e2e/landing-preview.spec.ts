import { expect, test } from "@playwright/test";

// Public-page checks: no signup, seeded database or live LLM calls required.
// Run against the rebuilt, trusted evaluation HTTPS origin before merging.
const screenshots = [
  ["Analytics overview", "/screenshots/3.webp"],
  ["Costs and tokens", "/screenshots/2.webp"],
  ["AI assistant", "/screenshots/1.webp"],
  ["Light-theme preview", "/screenshots/4.webp"],
] as const;

for (const viewport of [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  for (const theme of ["light", "dark"] as const) {
    test(`product screenshots: ${viewport.width}px, ${theme} theme`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme });
      const failures: string[] = [];
      const apiRequests: string[] = [];
      page.on("pageerror", error => failures.push(error.message));
      page.on("console", message => {
        if (message.type() === "error") failures.push(message.text());
      });
      page.on("request", request => {
        if (new URL(request.url()).pathname.startsWith("/api/v1/")) apiRequests.push(request.url());
      });
      page.on("response", response => {
        if (new URL(response.url()).pathname.startsWith("/screenshots/") && !response.ok()) {
          failures.push(`Screenshot returned HTTP ${response.status()}`);
        }
      });
      await page.goto("/");
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
      const preview = page.getByRole("figure", { name: /A closer look at your AI spending/ });
      await preview.scrollIntoViewIfNeeded();
      await expect(preview).toBeVisible();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const background = await preview.evaluate(el => getComputedStyle(el).backgroundColor);

      for (const [label, src] of screenshots) {
        await preview.getByRole("button", { name: label, exact: true }).click();
        await expect(preview.getByRole("button", { pressed: true })).toHaveCount(1);
        const image = preview.getByRole("img");
        await expect(image).toHaveAttribute("src", src);
        await image.scrollIntoViewIfNeeded();
        // A visible <img> is not enough: catch missing/broken assets and SPA fallbacks.
        await expect.poll(() => image.evaluate(el => {
          const img = el as HTMLImageElement;
          return img.complete && img.naturalWidth > 0 && new URL(img.currentSrc).pathname === img.getAttribute("src");
        })).toBe(true);
        const fullSize = preview.getByRole("link", { name: `Open ${label} screenshot in a new tab` });
        await expect(fullSize).toHaveAttribute("href", src);
        await expect(fullSize).toHaveAttribute("target", "_blank");
        await expect(fullSize).toHaveAttribute("rel", "noopener noreferrer");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        expect(await preview.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        await expect(preview).toHaveCSS("background-color", background);
        await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
      }

      // Actually follow the full-size link, not just inspect its href.
      const popupPromise = page.waitForEvent("popup");
      await preview.getByRole("link", { name: "Open Light-theme preview screenshot in a new tab" }).click();
      const popup = await popupPromise;
      await expect(popup).toHaveURL(/\/screenshots\/4\.webp$/);
      await expect.poll(() => popup.locator("img").evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await popup.close();

      const nextTheme = theme === "light" ? "dark" : "light";
      await page.getByRole("button", { name: `Switch to ${nextTheme} theme` }).click();
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${nextTheme}\\b`));
      // This catches a nested hardcoded dark class even when <html> toggles correctly.
      await expect.poll(() => preview.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(background);
      await expect(preview.getByRole("img")).toHaveAttribute("src", "/screenshots/4.webp");
      await page.reload();
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${nextTheme}\\b`));
      await expect(page.getByRole("button", { name: `Switch to ${theme} theme` })).toBeVisible();
      await expect(page.getByRole("banner").getByRole("link", { name: "Try tokenscope", exact: true })).toHaveAttribute("href", "/signup");
      await expect(page.getByRole("banner").getByRole("link", { name: "Log in", exact: true })).toHaveAttribute("href", "/signin");
      expect(apiRequests, "the signed-out screenshot gallery must not call the application API").toEqual([]);
      expect(failures).toEqual([]);
    });
  }
}
