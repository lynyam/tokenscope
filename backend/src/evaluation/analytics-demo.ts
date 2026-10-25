import { createHash } from "node:crypto";
import { parsePriceCatalogue } from "../pricing/price-catalogue";
import { normalizeTracePayload } from "../traces/trace-payload";
import { DAY_MS, requireSeed, SeedError } from "./seed-config";
import { fixtureDirectory, readFixture, stableJson, type SeedFixtures, type SeedTrace } from "./seed-fixtures";

export const ANALYTICS_SEED_VERSION = "1.3";
export const ANALYTICS_PROJECT_ID = "30000000-0000-4000-8000-000000000006";
export const ANALYTICS_DAILY_COUNTS = [60, 90, 120, 210, 165, 105, 90] as const;
export const ANALYTICS_TRACE_COUNT = 840;
const HOUR_MS = 3_600_000;
const CANONICAL_PRICE_START = "2026-10-01T00:00:00.000Z";
const PROVIDERS = ["aurora", "boreal", "cascade", "delta"] as const;
const MODELS = ["mini", "standard", "pro"] as const;
const WORKFLOWS = ["support", "summarization", "classification", "report-generation"] as const;
const MODEL_WEIGHTS = [24, 12, 4, 14, 7, 3, 18, 8, 2, 5, 2, 1] as const;
const WORKFLOW_WEIGHTS = [45, 30, 15, 10] as const;

export interface AnalyticsDemo {
  project: SeedFixtures["projects"][number];
  range: { from: string; to: string };
  prices: SeedFixtures["prices"];
  traces: SeedTrace[];
}

/** One captured clock per invocation, rounded down; never manufacture future data. */
export function analyticsWindowEnd(now: Date): string {
  requireSeed(Number.isFinite(now.getTime()), "Invalid analytics reference time.");
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS).toISOString();
}

/** Fixed xorshift32 sequence, for synthetic variation only (not cryptography). */
function randomSequence() {
  let state = 0x70e07;
  return (upperExclusive: number): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % upperExclusive;
  };
}

export function buildAnalyticsDemo(
  organizationId: string,
  end: string,
  now = new Date(),
  directory = fixtureDirectory(),
): AnalyticsDemo {
  const endMs = Date.parse(end);
  requireSeed(Number.isFinite(endMs) && new Date(endMs).toISOString() === end &&
    endMs % HOUR_MS === 0 && endMs <= now.getTime(),
  "Analytics window end must be a canonical completed UTC hour, not in the future.");
  const start = new Date(endMs - 7 * DAY_MS);
  requireSeed(start.getUTCFullYear() >= 1, "Analytics window is outside the supported date range.");
  const range = { from: start.toISOString(), to: end };
  const raw = readFixture("analytics-demo/model-prices.json", directory);
  const canonical = parsePriceCatalogue(raw);
  requireSeed(canonical.length === 12, "Analytics demo requires twelve synthetic model prices.");
  const prices = canonical.map((price, index) => {
    const provider = PROVIDERS[Math.floor(index / 3)];
    requireSeed(price.id === "40000000-0000-4000-8000-" + String(1001 + index).padStart(12, "0") &&
      price.provider === "demo-" + provider && price.model === provider + "-" + MODELS[index % 3] &&
      price.effectiveFrom === CANONICAL_PRICE_START && price.isSynthetic && price.sourceUrl === null,
    "Analytics catalogue identities, dates and synthetic markers must match its version.");
    return { ...price, id: price.id!, effectiveFrom: range.from };
  });
  const next = randomSequence();
  function pick(weights: readonly number[]): number {
    let value = next(weights.reduce((sum, weight) => sum + weight, 0));
    for (const [index, weight] of weights.entries()) {
      if (value < weight) return index;
      value -= weight;
    }
    throw new SeedError("SEED_FIXTURES", "Invalid analytics generator weights.");
  }
  const between = (min: number, max: number) => min + next(max - min + 1);
  const traces: SeedTrace[] = [];
  for (const [day, count] of ANALYTICS_DAILY_COUNTS.entries()) {
    for (let index = 0; index < count; index++) {
      // Guarantee all twelve combinations each day, then use unequal traffic shares.
      const modelIndex = index < 12 ? index : pick(MODEL_WEIGHTS);
      const price = prices[modelIndex];
      const workflowIndex = day === 3 && index % 3 === 0 ? 3 : pick(WORKFLOW_WEIGHTS);
      const workflow = WORKFLOWS[workflowIndex];
      const inputs = [[300, 3500], [4000, 30000], [100, 2000], [1000, 8000]][workflowIndex];
      const outputs = [[60, 900], [100, 1000], [20, 150], [1800, 6000]][workflowIndex];
      let inputTokens = between(inputs[0], inputs[1]);
      let outputTokens = between(outputs[0], outputs[1]);
      const sequence = traces.length + 1;
      const error = sequence % 19 === 0 || (day === 3 && index % 37 === 0);
      if (error) {
        if (sequence % 2 === 0) { inputTokens = 0; outputTokens = 0; }
        else outputTokens = Math.floor(outputTokens / 4);
      }
      let latencyMs = [150, 700, 1400][modelIndex % 3] + Math.floor(outputTokens / 3) + next(600);
      if (sequence % 37 === 0) latencyMs += 6000;
      if (error) latencyMs = between(4000, 9000);
      // Traffic occurs 02:00–21:59 within each rolling 24-hour block. Leave quiet
      // buckets and two hours of margin at both ends for a just-opened 7d preset.
      const minute = 120 + Math.floor(index * 1200 / count);
      const occurredAt = new Date(start.getTime() + day * DAY_MS + minute * 60_000 + next(60) * 1000).toISOString();
      const body = normalizeTracePayload({
        externalId: "analytics-" + String(sequence).padStart(4, "0"),
        provider: price.provider, model: price.model, workflow,
        inputTokens, outputTokens, latencyMs, status: error ? "ERROR" : "SUCCESS",
        occurredAt, metadata: { environment: "evaluation", synthetic: true },
      }, now);
      traces.push({
        id: "50000000-0000-4000-8000-" + String(1001 + traces.length).padStart(12, "0"),
        projectId: ANALYTICS_PROJECT_ID, body,
      });
    }
  }
  requireSeed(traces.length === ANALYTICS_TRACE_COUNT, "Analytics trace count differs from its version.");
  return {
    project: {
      id: ANALYTICS_PROJECT_ID, organizationId, name: "Analytics Demo", slug: "analytics-demo",
      description: "Synthetic seven-day evaluation dataset: four fictional providers, twelve models, varied token usage, latency and upstream request outcomes across support, summarization, classification and report generation. Rates are demonstration values, not commercial quotes. Day four has more traffic and longer generated reports. No real provider requests created these traces.",
      archivedAt: null,
    },
    range, prices, traces,
  };
}

/** Preserve the canonical fixtures and their exact expectations; append one project. */
export function withAnalyticsDemo(base: SeedFixtures, demo: AnalyticsDemo): SeedFixtures {
  const { fingerprint: _baseFingerprint, ...canonical } = base;
  const data = {
    ...canonical, version: ANALYTICS_SEED_VERSION,
    projects: [...base.projects, demo.project],
    prices: [...base.prices, ...demo.prices],
    traces: [...base.traces, ...demo.traces],
    analyticsDemo: {
      projectId: demo.project.id, range: demo.range, providers: 4, models: 12, traces: demo.traces.length,
    },
  };
  // Also reject accidental overlap with future edits to the canonical fixtures.
  for (const rows of [data.projects, data.prices, data.traces]) {
    requireSeed(new Set(rows.map(row => row.id)).size === rows.length, "Analytics IDs overlap canonical fixtures.");
  }
  const basePairs = new Set(base.prices.map(row => row.provider + "/" + row.model));
  requireSeed(demo.prices.every(row => !basePairs.has(row.provider + "/" + row.model)),
    "Analytics price identities overlap canonical fixtures.");
  return { ...data, fingerprint: createHash("sha256").update(stableJson(data)).digest("hex") };
}
