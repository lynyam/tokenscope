import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createOrganization, createProject, signInPage, signUp, type TestUser } from "./helpers";
import { createApiKey, fixtureBodies, goldenSearch, ingest, ingestAll, requireCatalogue } from "./trace-helpers";
import { records } from "../features/analytics/csv-records";
import type { AnalyticsSnapshot } from "../../src/types/analytics.types";

test.describe.configure({ mode: "serial" });
let owner: TestUser;
let organizationId: string;
let projectId: string;
let key: string;
const projectName = "Export Équipe Ελληνικά Кириллица";
const path = () => `/organizations/${organizationId}/projects/${projectId}`;

test.beforeAll(async ({ request }) => {
  owner = await signUp(request, "export-owner");
  await requireCatalogue(request, owner);
  organizationId = await createOrganization(request, owner);
  projectId = await createProject(request, owner, organizationId, projectName);
  key = await createApiKey(request, owner, organizationId, projectId);
  await ingestAll(request, key, fixtureBodies("traces-golden.json"));
});

async function open(page: Page, search: string) {
  const snapshots = new Map<string, AnalyticsSnapshot>();
  page.on("response", async response => {
    if (!new URL(response.url()).pathname.endsWith(`/projects/${projectId}/analytics`) || response.status() !== 200) return;
    try {
      const snapshot = await response.json() as AnalyticsSnapshot;
      snapshots.set(snapshot.snapshotId, snapshot);
    } catch { /* A navigation may cancel an unrelated background response. */ }
  });
  await signInPage(page, owner);
  await page.goto(path() + search);
  await expect(page.getByRole("button", { name: "Export CSV", exact: true })).toBeEnabled();
  return snapshots;
}

async function bytes(download: Download) {
  expect(await download.failure()).toBeNull();
  return readFile((await download.path())!);
}

async function pdfText(download: Download): Promise<string> {
  const data = await bytes(download);
  expect(data.subarray(0, 5).toString()).toBe("%PDF-");
  const task = getDocument({ data: new Uint8Array(data), disableFontFace: true });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(content.items.map(item => "str" in item ? item.str : "").join(" "));
    }
    return pages.join("\n").replace(/\s+/g, "");
  } finally { await task.destroy(); }
}

async function download(page: Page, format: "CSV" | "PDF") {
  const button = page.getByRole("button", { name: `Export ${format}`, exact: true });
  await expect(button).toBeEnabled();
  const pending = page.waitForEvent("download");
  // Read the displayed identity and click in the same browser task: a background
  // refresh between two Playwright commands must not make this assertion flaky.
  const snapshotId = await button.evaluate((element: HTMLButtonElement) => {
    const id = document.querySelector('[aria-label="Summary"]')?.getAttribute("data-snapshot-id");
    element.click();
    return id!;
  });
  return { snapshotId, pending };
}

async function capturedSnapshot(snapshots: Map<string, AnalyticsSnapshot>, id: string) {
  await expect.poll(() => snapshots.has(id)).toBe(true);
  return snapshots.get(id)!;
}

for (const scenario of [
  { name: "golden", search: goldenSearch(), count: 6, cost: "0.015350000000", pdfCost: "0.01535" },
  { name: "filtered", search: goldenSearch("&provider=fixture-a"), count: 3, cost: "0.007150000000", pdfCost: "0.00715" },
  { name: "empty", search: "?from=2026-10-02T00:00:00.000Z&to=2026-10-03T00:00:00.000Z", count: 0, cost: "0.000000000000", pdfCost: "0.00" },
]) {
  test(`${scenario.name}: downloads the displayed CSV and a complete local PDF`, async ({ page }) => {
    const snapshots = await open(page, scenario.search);
    const csvExport = await download(page, "CSV");
    const snapshot = await capturedSnapshot(snapshots, csvExport.snapshotId);
    expect(snapshot.summary.traceCount).toBe(scenario.count);
    expect(snapshot.summary.estimatedCostUsd).toBe(scenario.cost);
    const csvFile = await csvExport.pending;
    expect(csvFile.suggestedFilename()).toMatch(/^tokenscope-dashboard-\d{8}T\d{6}Z\.csv$/);
    const csv = records((await bytes(csvFile)).toString("utf8"));
    expect(csv).toHaveLength(1 + snapshot.series.length + snapshot.byModel.length);
    for (const row of csv) {
      expect(row.snapshotId).toBe(snapshot.snapshotId);
      expect(row.projectId).toBe(projectId);
      expect(row.projectName).toBe(projectName);
      expect(row.from).toBe(snapshot.window.from);
      expect(row.to).toBe(snapshot.window.to);
      expect(row.generatedAt).toBe(snapshot.generatedAt);
      expect(row.filterProvider).toBe(snapshot.filters.provider ?? "");
    }
    const summary = csv[0];
    expect(summary.section).toBe("summary");
    expect(summary.estimatedCostUsd).toBe(scenario.cost);
    expect(summary.inputTokens).toBe(snapshot.summary.inputTokens);
    expect(summary.outputTokens).toBe(snapshot.summary.outputTokens);
    expect(summary.traceCount).toBe(String(scenario.count));
    expect(csv.filter(r => r.section === "series").map(r => [r.bucketStart, r.estimatedCostUsd])).toEqual(
      snapshot.series.map(row => [row.bucketStart, row.estimatedCostUsd]));
    expect(csv.filter(r => r.section === "model").map(r => [r.provider, r.model, r.estimatedCostUsd])).toEqual(
      snapshot.byModel.map(row => [row.provider, row.model, row.estimatedCostUsd]));

    const pdfExport = await download(page, "PDF");
    const pdfSnapshot = await capturedSnapshot(snapshots, pdfExport.snapshotId);
    const pdfFile = await pdfExport.pending;
    expect(pdfFile.suggestedFilename()).toMatch(/^tokenscope-dashboard-\d{8}T\d{6}Z\.pdf$/);
    const text = await pdfText(pdfFile);
    for (const value of [projectName, projectId, pdfSnapshot.snapshotId, pdfSnapshot.generatedAt, pdfSnapshot.window.from, pdfSnapshot.window.to]) {
      expect(text).toContain(value.replace(/\s+/g, ""));
    }
    for (const row of snapshot.series) expect(text).toContain(row.bucketStart);
    for (const row of snapshot.byModel) expect(text).toContain(row.provider + row.model);
    expect(text).toContain("Estimatedcost(USD)" + scenario.pdfCost);
    expect(text).toContain("Inputtokens" + snapshot.summary.inputTokens);
    expect(text).toContain("Outputtokens" + snapshot.summary.outputTokens);
    if (snapshot.filters.provider) expect(text).toContain("Provider" + snapshot.filters.provider);
    if (!scenario.count) expect(text).toContain("Noobservations");
    expect(text).toContain("Costsare recorded estimates, not invoices.".replace(/\s+/g, ""));
  });
}

test("a real realtime refresh cannot change the PDF captured before its font loaded", async ({ page, request }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  // Delay only a local font asset; backend responses and realtime remain real.
  await page.route(/dejavu-sans\.font[^/]*\.(?:ts|js)(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
  });
  try {
    const snapshots = await open(page, goldenSearch());
    await expect(page.getByTestId("realtime-state")).toHaveText("Live", { timeout: 20_000 });
    const file = await download(page, "PDF");
    const captured = await capturedSnapshot(snapshots, file.snapshotId);
    await waiting;
    await ingest(request, key, { ...fixtureBodies("traces-golden.json")[0], externalId: `export-live-${Date.now()}` });
    await expect(page.getByTestId("metric").filter({ has: page.getByText("Traces", { exact: true }) })).toContainText("7");
    release();
    const text = await pdfText(await file.pending);
    expect(text).toContain(captured.snapshotId);
    expect(text).toContain("0.01535");
    expect(text).not.toContain("0.01715");
  } finally { release(); }
});
