import { defineConfig } from "@playwright/test";

// Real-browser suite (docs/LOCAL_DEVELOPMENT.md). It runs against an already started stack:
//   E2E_BASE_URL=https://localhost:8443 npm run e2e      (evaluation mode through Caddy)
//   E2E_BASE_URL=http://localhost:5173  npm run e2e      (development mode; the default)
// E2E_CHROMIUM_PATH optionally points to an installed Chromium instead of Playwright's download.
const executablePath = process.env.E2E_CHROMIUM_PATH;

export default defineConfig({
  testDir: "test/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Tests create their own disposable accounts, but uploads are rate limited per user: stay sequential.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    // The evaluation Caddy uses a local CA that browsers do not trust by default.
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath, args: ["--no-sandbox"] } : {},
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
