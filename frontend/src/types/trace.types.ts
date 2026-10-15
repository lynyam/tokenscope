/** Browser trace contract (docs/FRONTEND_TRACE_EXPLORER.md). Money and rates stay decimal strings. */

export type TraceStatus = "SUCCESS" | "ERROR";

export type TraceMetadata = Record<string, string | number | boolean | null>;

export interface TracePricing {
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  currency: "USD";
  isSynthetic: boolean;
}

export interface Trace {
  id: string;
  projectId: string;
  externalId: string;
  provider: string;
  model: string;
  workflow: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: TraceStatus;
  occurredAt: string;
  metadata: TraceMetadata;
  priceVersionId: string;
  pricing: TracePricing;
  inputCostUsd: string;
  outputCostUsd: string;
  estimatedCostUsd: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TracePage {
  items: Trace[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * The filters shared with the dashboard. Sorting and pagination are deliberately NOT part of it:
 * the assistant and the analytics must describe a selection, not a table view.
 */
export interface TraceFilters {
  from: string;
  to: string;
  q?: string;
  provider?: string;
  model?: string;
  workflow?: string;
  status?: TraceStatus;
}

export type TraceSortField =
  | "occurredAt"
  | "estimatedCostUsd"
  | "latencyMs"
  | "inputTokens"
  | "outputTokens";

export type TraceSortOrder = "asc" | "desc";

export interface TraceListQuery extends TraceFilters {
  sortBy: TraceSortField;
  sortOrder: TraceSortOrder;
  page: number;
  pageSize: number;
}

/** One historical price row from GET /model-prices (only the fields the Explorer reads). */
export interface ModelPrice {
  id: string;
  provider: string;
  model: string;
}
