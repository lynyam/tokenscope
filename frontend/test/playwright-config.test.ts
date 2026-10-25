import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function config(seeded: boolean) {
  vi.resetModules();
  vi.stubEnv("E2E_BASE_URL", "https://localhost:8443");
  vi.stubEnv("E2E_EVALUATION_SEED", seeded ? "1" : "0");
  return (await import("../playwright.config")).default;
}

it("does not persist seeded-password action details in an HTML report", async () => {
  const value = await config(true);
  expect(value.reporter).toEqual([["line"]]);
  expect(value.use).toMatchObject({ trace: "off", screenshot: "off", video: "off" });
});

it("uses branded Chrome/Edge and Firefox without bypassing TLS", async () => {
  const value = await config(false);
  expect(value.projects?.map(project => [project.name, project.use?.defaultBrowserType, project.use?.channel])).toEqual([
    ["chrome", "chromium", "chrome"], ["firefox", "firefox", undefined], ["edge", "chromium", "msedge"],
  ]);
  expect(value.use?.ignoreHTTPSErrors).not.toBe(true);
  expect(value.workers).toBe(1);
  expect(value.retries).toBe(0);
  expect(value.reporter).toEqual([["list"], ["html", { open: "never" }]]);
  for (const project of value.projects ?? []) {
    expect(project.use?.ignoreHTTPSErrors).not.toBe(true);
    expect(project.use?.launchOptions?.args).toBeUndefined();
    expect(project.use?.launchOptions?.executablePath).toBeUndefined();
  }
});
