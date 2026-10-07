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
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});