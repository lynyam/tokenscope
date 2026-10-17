import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { type TestUser } from "./helpers";

const API = "/api/v1";
const FIXTURES = path.resolve(__dirname, "../../../fixtures/evaluation");

export interface TraceBody {
  externalId: string; provider: string; model: string; workflow: string;
  inputTokens: number; outputTokens: number; latencyMs: number;
  status: "SUCCESS" | "ERROR"; occurredAt: string; metadata: Record<string, string | number | boolean | null>;
}
export interface Ingested { id: string; etag: string }

/** The `body` of every wrapper in a fixture file is one public trace request. */
export const fixtureBodies = (name: "traces-golden.json" | "traces-pagination.json"): TraceBody[] =>
  (JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8")) as { body: TraceBody }[]).map(item => item.body);

export const GOLDEN_FROM = "2026-10-01T00:00:00.000Z";
export const GOLDEN_TO = "2026-10-02T00:00:00.000Z";
export const goldenSearch = (extra = "") => `?from=${GOLDEN_FROM}&to=${GOLDEN_TO}${extra}`;

export const tracesPath = (organizationId: string, projectId: string, search = "") =>
  `/organizations/${organizationId}/projects/${projectId}/traces${search}`;

/** The price catalogue is loaded by an operator command, never by the browser. Fail early and say how. */
export async function requireCatalogue(request: APIRequestContext, user: TestUser) {
  const response = await request.get(`${API}/model-prices`, { headers: { Authorization: `Bearer ${user.token}` } });
  expect(response.status(), "GET /model-prices").toBe(200);
  const rows = (await response.json()) as { provider: string; model: string }[];
  const has = (provider: string, model: string) => rows.some(row => row.provider === provider && row.model === model);
  expect(
    has("fixture-a", "demo-fast") && has("fixture-b", "demo-large"),
    "The fixture price catalogue is not loaded. See docs/LOCAL_DEVELOPMENT.md, \"Trace Explorer browser tests\".",
  ).toBe(true);
}

export async function createApiKey(request: APIRequestContext, owner: TestUser, organizationId: string, projectId: string): Promise<string> {
  const response = await request.post(`${API}/organizations/${organizationId}/projects/${projectId}/api-keys`, {
    headers: { Authorization: `Bearer ${owner.token}` }, data: { name: "e2e traces" },
  });
  expect(response.status(), "create API key").toBe(201);
  return (await response.json()).key;
}

// Public ingestion allows 60 requests per minute per client address: stay under it and honour Retry-After.
const sent: number[] = [];
async function pace() {
  const now = Date.now();
  while (sent.length && now - sent[0] > 61_000) sent.shift();
  if (sent.length >= 55) await new Promise(resolve => setTimeout(resolve, 61_000 - (now - sent[0]) + 250));
  sent.push(Date.now());
}

async function publicCall(send: () => Promise<APIResponse>) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await pace();
    const response = await send();
    if (response.status() !== 429) return response;
    await new Promise(resolve => setTimeout(resolve, (Number(response.headers()["retry-after"]) || 30) * 1000));
  }
  throw new Error("Public API kept answering 429.");
}

export async function ingest(request: APIRequestContext, key: string, body: TraceBody): Promise<Ingested> {
  const response = await publicCall(() => request.post(`${API}/public/traces`, { headers: { "X-API-Key": key }, data: body }));
  expect(response.status(), `ingest ${body.externalId}`).toBe(201);
  return { id: (await response.json()).id, etag: response.headers()["etag"] };
}

export async function ingestAll(request: APIRequestContext, key: string, bodies: TraceBody[]): Promise<Map<string, Ingested>> {
  const result = new Map<string, Ingested>();
  for (const body of bodies) result.set(body.externalId, await ingest(request, key, body));
  return result;
}

export async function deletePublic(request: APIRequestContext, key: string, trace: Ingested) {
  const response = await publicCall(() =>
    request.delete(`${API}/public/traces/${trace.id}`, { headers: { "X-API-Key": key, "If-Match": trace.etag } }));
  expect(response.status(), "delete trace").toBe(204);
}

/** External IDs shown by the table, in display order. */
export async function visibleExternalIds(page: Page): Promise<string[]> {
  return page.getByRole("link", { name: /^View trace / }).evaluateAll(
    links => links.map(link => (link.getAttribute("aria-label") ?? "").replace("View trace ", "")),
  );
}
