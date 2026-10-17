/// <reference types="node" />
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error(
    "E2E_BASE_URL must be the running frontend origin, for example http://localhost:5173.",
  );
}

const executablePath = process.env.E2E_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
    // Credentials and one-time API-key secrets appear on these pages: never record them.
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: executablePath
      ? { executablePath, args: ["--no-sandbox"] }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
