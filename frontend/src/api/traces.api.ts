import { ApiError, apiGet } from "./http-client";
import { traceQueryToApiParams } from "./trace-filters";
import type { ModelPrice, Trace, TraceListQuery, TracePage } from "../types/trace.types";

const invalid = () =>
  new ApiError(200, "INVALID_API_RESPONSE", "The server returned an unexpected response.");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isDecimal = (value: unknown): value is string =>
  typeof value === "string" && /^\d+(\.\d+)?$/.test(value);

function toTrace(value: unknown): Trace {
  if (!isRecord(value)) throw invalid();
  const pricing = value.pricing;
  if (
    !isString(value.id) || !isString(value.projectId) || !isString(value.externalId) ||
    !isString(value.provider) || !isString(value.model) || !isString(value.workflow) ||
    !isCount(value.inputTokens) || !isCount(value.outputTokens) || !isCount(value.latencyMs) ||
    (value.status !== "SUCCESS" && value.status !== "ERROR") ||
    !isString(value.occurredAt) || !isRecord(value.metadata) || !isString(value.priceVersionId) ||
    !isRecord(pricing) || !isDecimal(pricing.inputUsdPerMillion) || !isDecimal(pricing.outputUsdPerMillion) ||
    pricing.currency !== "USD" || typeof pricing.isSynthetic !== "boolean" ||
    !isDecimal(value.inputCostUsd) || !isDecimal(value.outputCostUsd) || !isDecimal(value.estimatedCostUsd) ||
    !isCount(value.version) || !isString(value.createdAt) || !isString(value.updatedAt)
  ) {
    throw invalid();
  }
  return value as unknown as Trace;
}

function toTracePage(value: unknown): TracePage {
  if (
    !isRecord(value) || !Array.isArray(value.items) ||
    !isCount(value.page) || !isCount(value.pageSize) || !isCount(value.total) || !isCount(value.totalPages)
  ) {
    throw invalid();
  }
  return {
    items: value.items.map(toTrace),
    page: value.page,
    pageSize: value.pageSize,
    total: value.total,
    totalPages: value.totalPages,
  };
}

const tracesPath = (organizationId: string, projectId: string) =>
  "/organizations/" + encodeURIComponent(organizationId) +
  "/projects/" + encodeURIComponent(projectId) + "/traces";

export async function listTraces(
  organizationId: string,
  projectId: string,
  query: TraceListQuery,
  signal?: AbortSignal,
): Promise<TracePage> {
  const path = tracesPath(organizationId, projectId) + "?" + traceQueryToApiParams(query).toString();
  return toTracePage(await apiGet<unknown>(path, { signal }));
}

export async function getTrace(
  organizationId: string,
  projectId: string,
  traceId: string,
  signal?: AbortSignal,
): Promise<Trace> {
  const path = tracesPath(organizationId, projectId) + "/" + encodeURIComponent(traceId);
  return toTrace(await apiGet<unknown>(path, { signal }));
}

export interface ModelChoices {
  providers: string[];
  modelsByProvider: Record<string, string[]>;
}

/** Deduplicated provider and model choices built from the price catalogue. */
export async function getModelChoices(signal?: AbortSignal): Promise<ModelChoices> {
  const rows = await apiGet<unknown>("/model-prices", { signal });
  if (!Array.isArray(rows)) throw invalid();
  const sets = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!isRecord(row) || !isString(row.provider) || !isString(row.model)) throw invalid();
    const price = row as unknown as ModelPrice;
    if (!sets.has(price.provider)) sets.set(price.provider, new Set());
    sets.get(price.provider)!.add(price.model);
  }
  const providers = [...sets.keys()].sort();
  const modelsByProvider: Record<string, string[]> = {};
  for (const provider of providers) modelsByProvider[provider] = [...sets.get(provider)!].sort();
  return { providers, modelsByProvider };
}
