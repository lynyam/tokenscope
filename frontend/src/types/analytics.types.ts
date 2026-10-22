import type { TraceFilters, TraceStatus } from "./trace.types";

/** Mirrors the TSE-71 contract (docs/API.md, "Analytics"). Costs and token counts stay decimal strings. */

export type AnalyticsBucket = "hour" | "day";

export interface AnalyticsTotals {
  traceCount: number;
  inputTokens: string;
  outputTokens: string;
  estimatedCostUsd: string;
}

export interface AnalyticsSnapshot {
  snapshotId: string;
  generatedAt: string;
  projectId: string;
  window: { from: string; to: string; timezone: "UTC"; bucket: AnalyticsBucket };
  filters: {
    q: string | null;
    provider: string | null;
    model: string | null;
    workflow: string | null;
    status: TraceStatus | null;
  };
  summary: AnalyticsTotals & {
    totalTokens: string;
    errorCount: number;
    /** null means "no observations", never 0. */
    errorRatePct: number | null;
    averageLatencyMs: number | null;
  };
  series: Array<AnalyticsTotals & { bucketStart: string }>;
  byModel: Array<AnalyticsTotals & { provider: string; model: string }>;
}

/** The filters of a selection: the shared trace filters without the dates. */
export type DashboardFilters = Omit<TraceFilters, "from" | "to">;

/**
 * The one applied selection of the dashboard. The analytics request, the assistant (TSE-81)
 * and the export (TSE-77) all start from this object.
 */
export interface AppliedSelection {
  organizationId: string;
  projectId: string;
  from: string;
  to: string;
  filters: DashboardFilters;
}
