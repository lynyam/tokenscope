/// <reference types="node" />
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error(
    "E2E_BASE_URL must be the running frontend origin, for example http://localhost:5173.",
  );
}

// Optional: use an installed Chromium instead of Playwright's download.
const executablePath = process.env.E2E_CHROMIUM_PATH;

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
  // The seeded suite uses an operator password; do not persist action arguments
  // (including fill values) in an HTML report for this explicit run.
  reporter: process.env.E2E_EVALUATION_SEED === "1"
    ? [["line"]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    // The evaluation Caddy uses a local CA that browsers do not trust by default.
    //ignoreHTTPSErrors: true,
    acceptDownloads: true,
    // Login and authenticated requests contain credentials.
    // Do not record them in automatic test artifacts.
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: executablePath ? { executablePath, args: ["--no-sandbox"] } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
