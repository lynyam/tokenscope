import "reflect-metadata";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prisma } from "../../src/generated/prisma/client";
import { calculateTraceCost } from "../../src/pricing/calculate-trace-cost";
import { analyticsWindowEnd, buildAnalyticsDemo, withAnalyticsDemo, ANALYTICS_DAILY_COUNTS, ANALYTICS_PROJECT_ID } from "../../src/evaluation/analytics-demo";
import { DEFAULT_ANCHOR, DAY_MS } from "../../src/evaluation/seed-config";
import { fixtureDirectory, loadSeedFixtures, readFixture, stableJson } from "../../src/evaluation/seed-fixtures";
import { seedSummary } from "../../src/evaluation/seed-evaluation";
import { demoExpectations } from "./analytics-demo-oracle";

const now = new Date("2026-10-24T18:30:00.000Z");
const end = "2026-10-24T18:00:00.000Z";
const base = loadSeedFixtures(DEFAULT_ANCHOR, fixtureDirectory(), now);
const build = (until = end, clock = now, directory = fixtureDirectory()) =>
  buildAnalyticsDemo(base.organizations[0].id, until, clock, directory);
const expected = readFixture("analytics-demo/expected-results.json");

describe("deterministic seven-day analytics demo", () => {
  it("captures a completed UTC hour without generating future timestamps", () => {
    expect(analyticsWindowEnd(now)).toBe(end);
    const demo = build();
    expect(demo.range).toEqual({ from: "2026-10-17T18:00:00.000Z", to: end });
    for (const trace of demo.traces) {
      expect(Date.parse(trace.body.occurredAt)).toBeGreaterThanOrEqual(Date.parse(demo.range.from) + 2 * 3_600_000);
      expect(Date.parse(trace.body.occurredAt)).toBeLessThan(Date.parse(demo.range.to) - 2 * 3_600_000);
      expect(trace.body.metadata).toEqual({ environment: "evaluation", synthetic: true });
    }
    expect(() => analyticsWindowEnd(new Date("invalid"))).toThrow();
  });
  it.each(["invalid", "2026-02-30T00:00:00.000Z", "2026-10-24T18:01:00.000Z",
    "2026-10-24T19:00:00.000Z", "2026-10-24T18:00:00Z"])("rejects invalid/future window %s", value => {
    expect(() => build(value)).toThrow();
  });
  it("has unequal traffic, twelve models every day, four providers and four workflows", () => {
    const demo = build();
    expect(demo.traces).toHaveLength(840);
    expect(new Set(demo.traces.map(row => row.id)).size).toBe(840);
    expect(new Set(demo.traces.map(row => row.body.externalId)).size).toBe(840);
    expect(new Set(demo.traces.map(row => row.body.provider)).size).toBe(4);
    expect(new Set(demo.traces.map(row => row.body.workflow)).size).toBe(4);
    const amounts: number[] = [];
    for (let day = 0; day < 7; day++) {
      const traces = demo.traces.filter(row =>
        Math.floor((Date.parse(row.body.occurredAt) - Date.parse(demo.range.from)) / DAY_MS) === day);
      amounts.push(traces.length);
      expect(new Set(traces.map(row => row.body.provider + "/" + row.body.model)).size).toBe(12);
    }
    expect(amounts).toEqual(ANALYTICS_DAILY_COUNTS);
    expect(demo.traces.some(row => row.body.inputTokens >= 29_000)).toBe(true);
    expect(demo.traces.some(row => row.body.outputTokens >= 5900)).toBe(true);
    expect(demo.traces.some(row => row.body.status === "ERROR" && row.body.inputTokens === 0)).toBe(true);
    expect(demo.traces.some(row => row.body.status === "ERROR" && row.body.inputTokens > 0)).toBe(true);
    expect(demo.traces.some(row => row.body.latencyMs > 7000)).toBe(true);
  });
  it("keeps deterministic values and fingerprints even when the wall clock advances", () => {
    const demo = build();
    const later = build(end, new Date(now.getTime() + 10 * DAY_MS));
    expect(stableJson(later)).toBe(stableJson(demo));
    expect(withAnalyticsDemo(base, later).fingerprint).toBe(withAnalyticsDemo(base, demo).fingerprint);
    const nextEnd = new Date(Date.parse(end) + DAY_MS).toISOString();
    const shifted = build(nextEnd, new Date(now.getTime() + DAY_MS));
    expect(demoExpectations(shifted)).toEqual(demoExpectations(demo));
    expect(Date.parse(shifted.prices[0].effectiveFrom) - Date.parse(demo.prices[0].effectiveFrom)).toBe(DAY_MS);
    for (const [index, trace] of shifted.traces.entries()) {
      expect(trace.id).toBe(demo.traces[index].id);
      expect(Date.parse(trace.body.occurredAt) - Date.parse(demo.traces[index].body.occurredAt)).toBe(DAY_MS);
    }
    expect(withAnalyticsDemo(base, shifted).fingerprint).not.toBe(withAnalyticsDemo(base, demo).fingerprint);
  });
  it("matches committed exact expectations using independent integer arithmetic", () => {
    const demo = build();
    expect(demoExpectations(demo)).toEqual(expected);
    let total = new Prisma.Decimal(0);
    for (const trace of demo.traces) {
      const price = demo.prices.find(row => row.provider === trace.body.provider && row.model === trace.body.model)!;
      expect(Date.parse(price.effectiveFrom)).toBeLessThanOrEqual(Date.parse(trace.body.occurredAt));
      const costs = calculateTraceCost({ ...trace.body,
        inputUsdPerMillion: new Prisma.Decimal(price.inputUsdPerMillion),
        outputUsdPerMillion: new Prisma.Decimal(price.outputUsdPerMillion) });
      total = total.plus(costs.estimatedCostUsd);
    }
    expect(total.toFixed(12)).toBe("8.550480200000");
    const expectations = demoExpectations(demo);
    expect(expectations.byRollingDay["4"].estimatedCostUsd).toBe("2.403306400000");
    expect(Number(expectations.byModel["demo-boreal/boreal-pro"].estimatedCostUsd))
      .toBeGreaterThan(Number(expectations.byModel["demo-aurora/aurora-mini"].estimatedCostUsd));
    expect(expectations.byModel["demo-boreal/boreal-pro"].traceCount)
      .toBeLessThan(expectations.byModel["demo-aurora/aurora-mini"].traceCount);
  });
  it("appends data without mutating golden prices, traces, requests or fingerprints", () => {
    const original = stableJson(base);
    const result = withAnalyticsDemo(base, build());
    expect(stableJson(base)).toBe(original);
    expect(result.projects).toHaveLength(6);
    expect(result.prices).toHaveLength(15);
    expect(result.traces).toHaveLength(899);
    expect(result.traces.slice(0, 59)).toEqual(base.traces);
    expect(result.prices.slice(0, 3)).toEqual(base.prices);
    expect(result.expected).toEqual(base.expected);
    expect(result.requests).toEqual(base.requests);
    expect(result.range).toEqual(base.range);
    expect(result.analyticsDemo?.projectId).toBe(ANALYTICS_PROJECT_ID);
    expect(result.version).toBe("1.3");
    expect(seedSummary({ database: "tokenscope" }, result, "upgraded")).toMatchObject({
      outcome: "upgraded", counts: { users: 4, organizations: 2, memberships: 4, projects: 6, modelPrices: 15, traces: 899 },
      analyticsDemo: { range: build().range, models: 12, providers: 4, traces: 840 },
    });
  });
  it.each(["missing", "duplicate", "count", "provider", "model", "id", "date", "real", "source"])(
    "refuses a malformed analytics catalogue: %s", scenario => {
      const directory = mkdtempSync(join(tmpdir(), "tokenscope-analytics-unit-"));
      try {
        cpSync(fixtureDirectory(), directory, { recursive: true });
        const file = join(directory, "analytics-demo/model-prices.json");
        const prices = JSON.parse(readFileSync(file, "utf8"));
        if (scenario === "missing") rmSync(file);
        else {
          if (scenario === "duplicate") prices[1] = prices[0];
          if (scenario === "count") prices.pop();
          if (scenario === "provider") prices[0].provider = "unexpected";
          if (scenario === "model") prices[0].model = "unexpected";
          if (scenario === "id") prices[0].id = base.prices[0].id;
          if (scenario === "date") prices[0].effectiveFrom = "2026-10-02T00:00:00.000Z";
          if (scenario === "real") prices[0].isSynthetic = false;
          if (scenario === "source") prices[0].sourceUrl = "https://example.test/not-a-quote";
          writeFileSync(file, JSON.stringify(prices));
        }
        expect(() => build(end, now, directory)).toThrow();
      } finally { rmSync(directory, { recursive: true, force: true }); }
    });
});
