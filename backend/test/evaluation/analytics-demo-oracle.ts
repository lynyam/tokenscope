import type { AnalyticsDemo } from "../../src/evaluation/analytics-demo";
import type { SeedTrace } from "../../src/evaluation/seed-fixtures";

/** Independent integer arithmetic: six-decimal rate * tokens = picodollars.
 * Does not call the production calculator or database analytics implementation. */
export function demoTotals(demo: AnalyticsDemo, traces: SeedTrace[] = demo.traces) {
  let cost = 0n;
  let input = 0n;
  let output = 0n;
  let latency = 0;
  let errors = 0;
  for (const { body } of traces) {
    const price = demo.prices.find(row => row.provider === body.provider && row.model === body.model)!;
    const inputRate = BigInt(price.inputUsdPerMillion.replace(".", ""));
    const outputRate = BigInt(price.outputUsdPerMillion.replace(".", ""));
    cost += BigInt(body.inputTokens) * inputRate + BigInt(body.outputTokens) * outputRate;
    input += BigInt(body.inputTokens);
    output += BigInt(body.outputTokens);
    latency += body.latencyMs;
    errors += Number(body.status === "ERROR");
  }
  const digits = cost.toString().padStart(13, "0");
  return {
    traceCount: traces.length,
    inputTokens: input.toString(), outputTokens: output.toString(),
    totalTokens: (input + output).toString(),
    estimatedCostUsd: digits.slice(0, -12) + "." + digits.slice(-12),
    errorCount: errors,
    errorRatePct: traces.length ? Math.round(errors * 10000 / traces.length) / 100 : null,
    averageLatencyMs: traces.length ? Math.round(latency * 1000 / traces.length) / 1000 : null,
  };
}

export function demoExpectations(demo: AnalyticsDemo) {
  const group = (key: (trace: SeedTrace) => string) => Object.fromEntries(
    [...new Set(demo.traces.map(key))].sort().map(value => [
      value, demoTotals(demo, demo.traces.filter(trace => key(trace) === value)),
    ]),
  );
  return {
    baseline: demoTotals(demo),
    byProvider: group(trace => trace.body.provider),
    byModel: group(trace => trace.body.provider + "/" + trace.body.model),
    byWorkflow: group(trace => trace.body.workflow),
    byRollingDay: group(trace => String(1 + Math.floor(
      (Date.parse(trace.body.occurredAt) - Date.parse(demo.range.from)) / 86_400_000))),
  };
}
