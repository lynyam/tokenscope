import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isEmail, isUUID } from "class-validator";
import { assertDatabaseText, plainObject, rejectUnknownFields } from "../common/validation/usage-values";
import { parsePriceCatalogue, type CatalogueEntry } from "../pricing/price-catalogue";
import { normalizeTracePayload } from "../traces/trace-payload";
import type { NormalizedTracePayload } from "../traces/dto/create-trace.dto";
import { DAY_MS, DEFAULT_ANCHOR, parseAnchor, requireSeed, SeedError } from "./seed-config";

export interface Identities {
  users: Array<{ id: string; email: string; displayName: string }>;
  organizations: Array<{ id: string; name: string; slug: string }>;
  memberships: Array<{ id: string; userId: string; organizationId: string; role: "OWNER" | "ADMIN" | "MEMBER" }>;
  projects: Array<{ id: string; organizationId: string; name: string; slug: string; description: string; archivedAt: string | null }>;
}
export interface SeedTrace {
  id: string;
  projectId: string;
  body: NormalizedTracePayload;
}
export interface SeedFixtures extends Identities {
  version: string;
  anchor: string;
  fingerprint: string;
  range: { from: string; to: string };
  prices: Array<CatalogueEntry & { id: string }>;
  traces: SeedTrace[];
  expected: Record<string, Record<string, unknown>>;
  expectedTraces: Array<Record<string, any>>;
  requests: { live: NormalizedTracePayload; correction: NormalizedTracePayload };
}

export function stableJson(value: unknown): string {
  function ordered(item: any): any {
    if (Array.isArray(item)) return item.map(ordered);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, ordered(item[key])]));
    }
    return item;
  }
  return JSON.stringify(ordered(value));
}

export function fixtureDirectory(): string {
  const candidates = [
    "/fixtures/evaluation", // read-only Compose mount, in both dev and eval
    resolve(__dirname, "../../../fixtures/evaluation"),
    resolve(process.cwd(), "fixtures/evaluation"),
    resolve(process.cwd(), "../fixtures/evaluation"),
  ];
  const found = candidates.find(dir => existsSync(resolve(dir, "manifest.json")));
  if (!found) throw new SeedError("SEED_FIXTURES", "Canonical fixtures/evaluation directory was not found.");
  return found;
}

export function readFixture(name: string, directory = fixtureDirectory()): unknown {
  try {
    const filename = resolve(directory, name);
    requireSeed(statSync(filename).size <= 1_048_576, "A fixture file exceeds 1 MiB.");
    return JSON.parse(readFileSync(filename, "utf8"));
  } catch {
    throw new SeedError("SEED_FIXTURES", "A required fixture file is missing, oversized or invalid JSON.");
  }
}

function list(value: unknown, count: number): Record<string, any>[] {
  requireSeed(Array.isArray(value) && value.length === count, "Fixture record count does not match the canonical dataset.");
  return value.map(row => plainObject(row, "fixture"));
}

function text(value: unknown, maximum: number): void {
  requireSeed(typeof value === "string" && value === value.trim() &&
    [...value].length >= 1 && [...value].length <= maximum, "Invalid fixture text.");
  assertDatabaseText(value, "fixture");
}

export function shiftInstant(value: string, anchor: string): string {
  const timestamp = Date.parse(value);
  requireSeed(Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value,
    "Fixture timestamps must be canonical UTC instants.");
  const shifted = new Date(timestamp + parseAnchor(anchor) - parseAnchor(DEFAULT_ANCHOR));
  requireSeed(Number.isFinite(shifted.getTime()) && shifted.getUTCFullYear() >= 1 &&
    shifted.getUTCFullYear() <= 9999, "Shifted timestamp is outside the supported range.");
  return shifted.toISOString();
}

export function loadSeedFixtures(anchor: string, directory = fixtureDirectory(), now = new Date()): SeedFixtures {
  parseAnchor(anchor);
  const manifest = plainObject(readFixture("manifest.json", directory), "manifest");
  requireSeed(manifest.specVersion === "1.2" && manifest.anchor === DEFAULT_ANCHOR &&
    manifest.synthetic === true, "Unsupported fixture manifest.");
  requireSeed(stableJson(manifest.counts) === stableJson({ users: 4, organizations: 2,
    memberships: 4, projects: 5, modelPrices: 3, goldenTraces: 6, paginationTraces: 51, isolationTraces: 2 }),
  "Manifest counts differ from the canonical dataset.");
  const raw = plainObject(readFixture("identities.json", directory), "identities");
  const users = list(raw.users, 4);
  const organizations = list(raw.organizations, 2);
  const memberships = list(raw.memberships, 4);
  const projects = list(raw.projects, 5);
  const ids = new Set<string>();
  const unique = new Set<string>();
  function identity(id: unknown): void {
    requireSeed(typeof id === "string" && isUUID(id) && !ids.has(id), "Invalid or duplicate fixture ID.");
    ids.add(id);
  }
  function key(value: string): void {
    requireSeed(!unique.has(value), "Duplicate fixture unique key.");
    unique.add(value);
  }
  for (const row of users) {
    rejectUnknownFields(row, ["id", "email", "displayName"]);
    identity(row.id); text(row.displayName, 80);
    requireSeed(typeof row.email === "string" && isEmail(row.email) &&
      row.email.length <= 254 && row.email === row.email.trim().toLowerCase(), "Invalid fixture email.");
    key(`email:${row.email}`);
  }
  const userIds = new Set(users.map(row => row.id));
  for (const row of organizations) {
    rejectUnknownFields(row, ["id", "name", "slug"]);
    identity(row.id); text(row.name, 80); text(row.slug, 100);
    requireSeed(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug), "Invalid organization slug.");
    key(`organization:${row.slug}`);
  }
  const organizationIds = new Set(organizations.map(row => row.id));
  for (const row of memberships) {
    rejectUnknownFields(row, ["id", "userId", "organizationId", "role"]);
    identity(row.id);
    requireSeed(userIds.has(row.userId) && organizationIds.has(row.organizationId) &&
      ["OWNER", "ADMIN", "MEMBER"].includes(row.role), "Invalid fixture membership.");
    key(`membership:${row.organizationId}:${row.userId}`);
  }
  for (const [index, row] of memberships.entries()) {
    requireSeed(row.userId === users[index].id &&
      row.organizationId === organizations[index === 3 ? 1 : 0].id &&
      row.role === ["OWNER", "ADMIN", "MEMBER", "OWNER"][index],
    "Memberships must preserve owner/admin/member and outsider isolation.");
  }
  for (const row of projects) {
    rejectUnknownFields(row, ["id", "organizationId", "name", "slug", "description", "archivedAt"]);
    identity(row.id); text(row.name, 80); text(row.slug, 100); text(row.description, 2000);
    requireSeed(organizationIds.has(row.organizationId) &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug), "Invalid fixture project.");
    requireSeed(row.archivedAt === null || typeof row.archivedAt === "string", "Invalid archive timestamp.");
    if (row.archivedAt !== null) row.archivedAt = shiftInstant(row.archivedAt, anchor);
    key(`project:${row.organizationId}:${row.slug}`);
  }
  const priceInput = list(readFixture("model-prices.json", directory), 3).map(row => ({
    ...row, effectiveFrom: shiftInstant(row.effectiveFrom, anchor),
  }));
  const prices = parsePriceCatalogue(priceInput).map(row => {
    identity(row.id);
    requireSeed(row.isSynthetic && row.sourceUrl === null, "Only synthetic fixture prices without source URLs are permitted.");
    return { ...row, id: row.id! };
  });
  const projectIds = new Set(projects.map(row => row.id));
  const traces: SeedTrace[] = [];
  for (const [filename, count] of [["traces-golden.json", 6], ["traces-pagination.json", 51], ["traces-isolation.json", 2]] as const) {
    for (const row of list(readFixture(filename, directory), count)) {
      rejectUnknownFields(row, ["fixtureId", "expectedSeedId", "projectId", "body"]);
      identity(row.expectedSeedId);
      requireSeed(projectIds.has(row.projectId), "Trace references an unknown project.");
      const body = plainObject(row.body, "trace");
      // Keep the production future-time rule. Never falsify the application clock.
      const normalized = normalizeTracePayload({ ...body, occurredAt: shiftInstant(body.occurredAt as string, anchor) }, now);
      requireSeed(normalized.metadata.synthetic === true &&
        normalized.metadata.environment === "evaluation" &&
        Object.keys(normalized.metadata).length === 2,
      "Trace fixture metadata must contain only the synthetic evaluation markers.");
      requireSeed(prices.some(price => price.provider === normalized.provider &&
        price.model === normalized.model && price.effectiveFrom <= normalized.occurredAt),
      "No applicable fixture price exists.");
      key(`trace:${row.projectId}:${normalized.externalId}`);
      traces.push({ id: row.expectedSeedId, projectId: row.projectId, body: normalized });
    }
  }
  for (const [index, project] of projects.entries()) {
    requireSeed(project.organizationId === organizations[index === 2 ? 1 : 0].id &&
      traces.filter(trace => trace.projectId === project.id).length === [6, 0, 1, 51, 1][index] &&
      (project.archivedAt !== null) === (index === 4),
    "Project fixture ownership, archive state or trace count is invalid.");
  }
  function request(name: string): NormalizedTracePayload {
    const body = plainObject(readFixture(name, directory), "request");
    return normalizeTracePayload({ ...body, occurredAt: shiftInstant(body.occurredAt as string, anchor) }, now);
  }
  const requests = {
    live: request("realtime/live-trace-request.json"),
    correction: request("requests/trace-001-replacement.json"),
  };
  const expectedTraces = list(readFixture("responses/traces-golden.json", directory), 6);
  for (const row of expectedTraces) {
    requireSeed(traces.slice(0, 6).some(trace => trace.id === row.id), "Unknown expected golden trace.");
    for (const field of ["inputCostUsd", "outputCostUsd", "estimatedCostUsd"]) {
      requireSeed(typeof row[field] === "string" && /^\d+\.\d{12}$/.test(row[field]), "Invalid expected trace cost.");
    }
    key(`expected:${row.id}`);
  }
  const expected = plainObject(readFixture("expected-results.json", directory), "expected") as SeedFixtures["expected"];
  for (const name of ["baseline", "provider_fixture_a", "provider_fixture_b", "workflow_batch", "status_ERROR",
    "to_15_exclusive", "after_live_insert", "after_T1_correction_from_baseline", "after_T1_delete_from_baseline", "empty"]) {
    const row = plainObject(expected[name], "expected");
    requireSeed(Number.isInteger(row.traceCount) && typeof row.estimatedCostUsd === "string" &&
      /^\d+\.\d{12}$/.test(row.estimatedCostUsd), "Invalid independent analytics expectations.");
  }
  const range = { from: new Date(parseAnchor(anchor)).toISOString(), to: new Date(parseAnchor(anchor) + DAY_MS).toISOString() };
  const data = { ...({ users, organizations, memberships, projects } as Identities),
    version: manifest.specVersion as string, anchor, range, prices, traces, expected, expectedTraces, requests };
  return { ...data, fingerprint: createHash("sha256").update(stableJson(data)).digest("hex") };
}
