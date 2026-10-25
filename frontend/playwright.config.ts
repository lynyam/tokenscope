/// <reference types="node" />
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error(
    "E2E_BASE_URL must be the running frontend origin, for example http://localhost:5173.",
  );
}

export default defineConfig({
  testDir: "./test/e2e",
  // Browser specs end in .spec.ts; Vitest only discovers .test.ts/.test.tsx.
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Uploads are rate limited per user: stay sequential.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    acceptDownloads: true,
    // Login and authenticated requests contain credentials.
    // Do not record them in automatic test artifacts.
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    // Installed Google Chrome (not Playwright's Chromium).
    { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    // Playwright's Firefox build; trusts the system certificate store for the evaluation CA.
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: { firefoxUserPrefs: { "security.enterprise_roots.enabled": true } },
      },
    },
    // Installed Microsoft Edge.
    { name: "edge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
  ],
});