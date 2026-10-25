import type { AnalyticsSnapshot, AppliedSelection, DashboardFilters } from "./analytics.types";

// The TSE-80 contract in docs/API.md; reuse the dashboard's analytics representation.
export type AssistantContext = Pick<AnalyticsSnapshot,
  "snapshotId" | "generatedAt" | "window" | "filters" | "summary" | "series" | "byModel"
> & {
  project: { id: string; name: string; description: string | null };
  pricing: { currency: "USD"; containsSyntheticPricing: boolean };
};

export type AssistantUsage = { inputTokens: number; outputTokens: number } | null;

export type StartPayload = {
  requestId: string;
  provider: string;
  model: string;
  context: AssistantContext;
};

export type DonePayload = {
  requestId: string;
  finishReason: 'stop' | 'length'; // 'length' = réponse tronquée
  usage: AssistantUsage;
};

export type ErrorPayload = {
  requestId: string;
  code: string;
  message: string;
  retryable: boolean;
};

export type AssistantEvent =
  | { type: 'start'; data: StartPayload }
  | { type: 'delta'; data: { text: string } }
  | { type: 'done'; data: DonePayload }
  | { type: 'error'; data: ErrorPayload };


export type AssistantFilters = DashboardFilters;

// The dashboard's applied selection (exact resolved UTC dates + active filters).
export type AssistantSelection = Pick<AppliedSelection, "from" | "to" | "filters">;

// The exact JSON body sent to the backend.
export type AskAssistantRequest = {
  question: string;
  from: string;
  to: string;
  filters: AssistantFilters;
};
