// Version simple : on précisera AssistantContext plus tard.

export type AssistantContext = Record<string, unknown>;

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


// PROVISIONAL: replace with the dashboard's shared filter type once TSE-76 exists.
export type AssistantFilters = {
  q?: string;
  provider?: string;
  model?: string;
  workflow?: string;
  status?: 'SUCCESS' | 'ERROR';
};

// The dashboard's applied selection (exact resolved UTC dates + active filters).
export type AssistantSelection = {
  from: string;
  to: string;
  filters: AssistantFilters;
};

// The exact JSON body sent to the backend.
export type AskAssistantRequest = {
  question: string;
  from: string;
  to: string;
  filters: AssistantFilters;
};