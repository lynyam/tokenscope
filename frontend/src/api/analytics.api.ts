import { ApiError, apiGet } from "./http-client";
import { parseUtcInstant } from "./trace-filters";
import type {
  AnalyticsBucket,
  AnalyticsSnapshot,
  AnalyticsTotals,
  AppliedSelection,
} from "../types/analytics.types";

const MAX_SERIES_POINTS = 5000;
const MAX_MODEL_GROUPS = 1000;

const invalid = () =>
  new ApiError(200, "INVALID_API_RESPONSE", "The server returned an unexpected response.");

const mismatch = () =>
  new ApiError(
    200,
    "ANALYTICS_SELECTION_MISMATCH",
    "The analytics do not match the selected project, period and filters.",
  );

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
// Exact aggregates arrive as text. They are never converted to numbers here.
const isDecimal = (value: unknown): value is string =>
  typeof value === "string" && /^\d+(\.\d+)?$/.test(value);
const isNullableNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

function toTotals(value: Record<string, unknown>): AnalyticsTotals {
  if (
    !isCount(value.traceCount) || !isDecimal(value.inputTokens) ||
    !isDecimal(value.outputTokens) || !isDecimal(value.estimatedCostUsd)
  ) {
    throw invalid();
  }
  return {
    traceCount: value.traceCount,
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    estimatedCostUsd: value.estimatedCostUsd,
  };
}

function toSnapshot(value: unknown): AnalyticsSnapshot {
  if (!isRecord(value)) throw invalid();
  const { window, filters, summary, series, byModel } = value;
  if (
    !isString(value.snapshotId) || !isString(value.generatedAt) || !isString(value.projectId) ||
    !isRecord(window) || !isRecord(filters) || !isRecord(summary) ||
    !Array.isArray(series) || !Array.isArray(byModel)
  ) {
    throw invalid();
  }

  if (
    !isString(window.from) || !isString(window.to) || window.timezone !== "UTC" ||
    (window.bucket !== "hour" && window.bucket !== "day") ||
    parseUtcInstant(window.from) === null || parseUtcInstant(window.to) === null
  ) {
    throw invalid();
  }

  if (
    !isNullableString(filters.q) || !isNullableString(filters.provider) ||
    !isNullableString(filters.model) || !isNullableString(filters.workflow) ||
    (filters.status !== null && filters.status !== "SUCCESS" && filters.status !== "ERROR")
  ) {
    throw invalid();
  }

  if (
    !isDecimal(summary.totalTokens) || !isCount(summary.errorCount) ||
    !isNullableNumber(summary.errorRatePct) || !isNullableNumber(summary.averageLatencyMs)
  ) {
    throw invalid();
  }
  const totals = toTotals(summary);

  if (series.length > MAX_SERIES_POINTS || byModel.length > MAX_MODEL_GROUPS) throw invalid();

  return {
    snapshotId: value.snapshotId,
    generatedAt: value.generatedAt,
    projectId: value.projectId,
    window: { from: window.from, to: window.to, timezone: "UTC", bucket: window.bucket as AnalyticsBucket },
    filters: {
      q: filters.q,
      provider: filters.provider,
      model: filters.model,
      workflow: filters.workflow,
      status: filters.status,
    },
    summary: {
      ...totals,
      totalTokens: summary.totalTokens,
      errorCount: summary.errorCount,
      errorRatePct: summary.errorRatePct,
      averageLatencyMs: summary.averageLatencyMs,
    },
    series: series.map(item => {
      if (!isRecord(item) || !isString(item.bucketStart) || parseUtcInstant(item.bucketStart) === null) throw invalid();
      return { ...toTotals(item), bucketStart: item.bucketStart };
    }),
    byModel: byModel.map(item => {
      if (!isRecord(item) || !isString(item.provider) || !isString(item.model)) throw invalid();
      return { ...toTotals(item), provider: item.provider, model: item.model };
    }),
  };
}

/** The response must describe exactly the selection that was requested. */
function assertSelectionMatches(snapshot: AnalyticsSnapshot, selection: AppliedSelection): void {
  const f = selection.filters;
  if (
    snapshot.projectId !== selection.projectId ||
    Date.parse(snapshot.window.from) !== Date.parse(selection.from) ||
    Date.parse(snapshot.window.to) !== Date.parse(selection.to) ||
    snapshot.filters.q !== (f.q || null) ||
    snapshot.filters.provider !== (f.provider || null) ||
    snapshot.filters.model !== (f.model || null) ||
    snapshot.filters.workflow !== (f.workflow || null) ||
    snapshot.filters.status !== (f.status || null)
  ) {
    throw mismatch();
  }
}

/** Explicit dates and only the active filters. No sorting, no pagination, no bucket (the server chooses it). */
export function analyticsQueryParams(selection: AppliedSelection): URLSearchParams {
  const params = new URLSearchParams();
  params.set("from", selection.from);
  params.set("to", selection.to);
  const f = selection.filters;
  if (f.q) params.set("q", f.q);
  if (f.provider) params.set("provider", f.provider);
  if (f.model) params.set("model", f.model);
  if (f.workflow) params.set("workflow", f.workflow);
  if (f.status) params.set("status", f.status);
  return params;
}

/** Two selections with the same key are the same selection (same project, exact dates, same filters). */
export function analyticsSelectionKey(selection: AppliedSelection): string {
  const f = selection.filters;
  return JSON.stringify([
    selection.organizationId,
    selection.projectId,
    selection.from,
    selection.to,
    f.q || null,
    f.provider || null,
    f.model || null,
    f.workflow || null,
    f.status || null,
  ]);
}

export async function getAnalytics(
  selection: AppliedSelection,
  signal?: AbortSignal,
): Promise<AnalyticsSnapshot> {
  const path =
    "/organizations/" + encodeURIComponent(selection.organizationId) +
    "/projects/" + encodeURIComponent(selection.projectId) +
    "/analytics?" + analyticsQueryParams(selection).toString();

  const snapshot = toSnapshot(await apiGet<unknown>(path, { signal }));
  assertSelectionMatches(snapshot, selection);
  return snapshot;
}
