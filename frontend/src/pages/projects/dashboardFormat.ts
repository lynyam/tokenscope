import { formatCostUsd } from "../../api/trace-format";
import type { AnalyticsSnapshot } from "../../types/analytics.types";

export { formatCostUsd };

export const NO_OBSERVATIONS = "No observations";

/** "1234567" -> "1,234,567". String work only: token counts are never turned into numbers. */
export function formatCount(value: string): string {
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : grouped + "." + fraction;
}

/** null means "no observations", never 0. */
export function formatErrorRate(value: number | null): string {
  return value === null ? NO_OBSERVATIONS : value.toFixed(2).replace(/\.?0+$/, "") + " %";
}

export function formatLatency(value: number | null): string {
  if (value === null) return NO_OBSERVATIONS;
  return (value >= 1000 ? (value / 1000).toFixed(2) + " s" : Math.round(value) + " ms");
}

/** "2026-10-01T03:00:00.000Z" -> "10-01 03:00" (hour buckets) or "10-01" (day buckets). */
export function bucketLabel(bucketStart: string, bucket: "hour" | "day"): string {
  return bucket === "hour" ? bucketStart.slice(5, 16).replace("T", " ") : bucketStart.slice(5, 10);
}

export interface CostPoint {
  label: string;
  bucketStart: string;
  /** For drawing only. The exact text is in `costText`. */
  cost: number;
  costText: string;
  traceCount: number;
}

export function costOverTime(snapshot: AnalyticsSnapshot): CostPoint[] {
  return snapshot.series.map(point => ({
    label: bucketLabel(point.bucketStart, snapshot.window.bucket),
    bucketStart: point.bucketStart,
    cost: Number(point.estimatedCostUsd),
    costText: point.estimatedCostUsd,
    traceCount: point.traceCount,
  }));
}

export interface ModelPoint {
  label: string; // provider / model
  provider: string;
  model: string;
  cost: number;
  costText: string;
  inputTokens: number;
  outputTokens: number;
  inputText: string;
  outputText: string;
  traceCount: number;
}

export function byModelPoints(snapshot: AnalyticsSnapshot): ModelPoint[] {
  return snapshot.byModel.map(entry => ({
    label: entry.provider + " / " + entry.model,
    provider: entry.provider,
    model: entry.model,
    cost: Number(entry.estimatedCostUsd),
    costText: entry.estimatedCostUsd,
    inputTokens: Number(entry.inputTokens),
    outputTokens: Number(entry.outputTokens),
    inputText: entry.inputTokens,
    outputText: entry.outputTokens,
    traceCount: entry.traceCount,
  }));
}
