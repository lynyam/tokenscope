import type { AnalyticsTotals } from "../types/analytics.types";
import type { AssistantContext } from "../types/assistant.types";
import { parseUtcInstant, validatePeriod } from "./trace-filters";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const nonempty = (value: unknown): value is string => text(value) && value.trim() !== "";
const instant = (value: unknown): value is string => text(value) && parseUtcInstant(value) !== null;
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const integerString = (value: unknown): value is string => text(value) && /^(0|[1-9]\d*)$/.test(value);
const cost = (value: unknown): value is string => text(value) && /^(0|[1-9]\d*)\.\d{12}$/.test(value);
const measurement = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);

function totals(value: unknown): value is AnalyticsTotals {
  return record(value) && count(value.traceCount) && integerString(value.inputTokens)
    && integerString(value.outputTokens) && cost(value.estimatedCostUsd);
}

/** Validate the network boundary before typed values can reach the context card.
 * This checks the wire shape, not a second calculation of the backend's analytics.
 */
export function isAssistantContext(value: unknown): value is AssistantContext {
  if (!record(value)) return false;
  const { project, window, filters, summary, pricing, series, byModel } = value;
  return nonempty(value.snapshotId) && instant(value.generatedAt)
    && record(project) && nonempty(project.id) && nonempty(project.name)
    && (project.description === null || text(project.description))
    && record(window) && instant(window.from) && instant(window.to)
    && validatePeriod(window.from, window.to) === null && window.timezone === "UTC"
    && (window.bucket === "hour" || window.bucket === "day")
    && record(filters)
    && ["q", "provider", "model", "workflow"].every(key => filters[key] === null || nonempty(filters[key]))
    && (filters.status === null || filters.status === "SUCCESS" || filters.status === "ERROR")
    && record(summary) && totals(summary) && integerString(summary.totalTokens)
    && count(summary.errorCount) && summary.errorCount <= summary.traceCount
    && measurement(summary.errorRatePct) && (summary.errorRatePct === null || summary.errorRatePct <= 100)
    && measurement(summary.averageLatencyMs)
    && Array.isArray(series) && series.every(item => record(item) && totals(item) && instant(item.bucketStart))
    && Array.isArray(byModel) && byModel.every(item => record(item) && totals(item) && nonempty(item.provider) && nonempty(item.model))
    && record(pricing) && pricing.currency === "USD" && typeof pricing.containsSyntheticPricing === "boolean";
}
