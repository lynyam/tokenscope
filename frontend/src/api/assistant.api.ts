import { apiPostStream } from "./http-client";
import type { ApiStreamResponse } from "./http-client";
import { AssistantStreamError, parseAssistantStream } from "./assistant-stream";
import type {
  AskAssistantRequest,
  AssistantEvent,
  AssistantFilters,
  AssistantSelection,
} from "../types/assistant.types";

export const MAX_QUESTION_LENGTH = 2000;
export const MAX_BODY_BYTES = 8 * 1024;
const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000;

export class AssistantRequestError extends Error {
  constructor(
    public readonly kind:
      | "empty-question"
      | "question-too-long"
      | "body-too-large"
      | "invalid-selection",
    message: string,
  ) {
    super(message);
    this.name = "AssistantRequestError";
  }
}

// For inline validation in the panel. Returns null when the question is valid.
export function validateAssistantQuestion(
  question: string,
): "empty" | "too-long" | null {
  const trimmed = question.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length > MAX_QUESTION_LENGTH) return "too-long";
  return null;
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

// Keeps only active filters, in a fixed key order. Workflow case is preserved.
// PROVISIONAL: align with the dashboard's existing normalization rules.
export function normalizeFilters(filters: Record<string, unknown>): AssistantFilters {
  const result: AssistantFilters = {};
  const q = cleanText(filters.q);
  if (q !== undefined) result.q = q;
  const provider = cleanText(filters.provider);
  if (provider !== undefined) result.provider = provider;
  const model = cleanText(filters.model);
  if (model !== undefined) result.model = model;
  const workflow = cleanText(filters.workflow);
  if (workflow !== undefined) result.workflow = workflow;
  if (filters.status === "SUCCESS" || filters.status === "ERROR") {
    result.status = filters.status;
  }
  return result;
}

function isUtcInstant(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

// Never repairs an invalid selection: it refuses it.
function assertValidSelection(selection: AssistantSelection): void {
  const { from, to } = selection;
  if (!isUtcInstant(from) || !isUtcInstant(to)) {
    throw new AssistantRequestError(
      "invalid-selection",
      "The selected period must use valid UTC dates.",
    );
  }
  const span = Date.parse(to) - Date.parse(from);
  if (span <= 0) {
    throw new AssistantRequestError(
      "invalid-selection",
      "The start of the period must be before its end.",
    );
  }
  if (span > MAX_RANGE_MS) {
    throw new AssistantRequestError(
      "invalid-selection",
      "The selected period cannot exceed 90 days.",
    );
  }
}

// Builds the body field by field: nothing else can leak into the request.
export function buildAssistantBody(
  question: string,
  selection: AssistantSelection,
): AskAssistantRequest {
  const trimmed = question.trim();
  if (trimmed.length === 0) {
    throw new AssistantRequestError("empty-question", "Enter a question.");
  }
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    throw new AssistantRequestError(
      "question-too-long",
      "The question must be at most " + MAX_QUESTION_LENGTH + " characters.",
    );
  }
  assertValidSelection(selection);

  const body: AskAssistantRequest = {
    question: trimmed,
    from: selection.from,
    to: selection.to,
    filters: normalizeFilters(selection.filters),
  };

  // The limit is in bytes of the serialized JSON, not in string length.
  if (new TextEncoder().encode(JSON.stringify(body)).length > MAX_BODY_BYTES) {
    throw new AssistantRequestError(
      "body-too-large",
      "The request is too large. Please shorten your question.",
    );
  }
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameInstant(value: unknown, expected: string): boolean {
  return typeof value === "string" && Date.parse(value) === Date.parse(expected);
}

type ExpectedScope = {
  projectId: string;
  from: string;
  to: string;
  filters: AssistantFilters;
};

// ASSUMPTION to confirm with the backend fixtures: context.window = { from, to }.
function assertContextMatches(
  context: Record<string, unknown>,
  expected: ExpectedScope,
): void {
  const mismatch = () =>
    new AssistantStreamError("protocol", "The returned context does not match the request.");

  if (!isRecord(context.project) || context.project.id !== expected.projectId) {
    throw mismatch();
  }
  if (
    !isRecord(context.window) ||
    !sameInstant(context.window.from, expected.from) ||
    !sameInstant(context.window.to, expected.to)
  ) {
    throw mismatch();
  }
  if (!isRecord(context.filters)) throw mismatch();

  const returned = normalizeFilters(context.filters);
  for (const key of ["q", "provider", "model", "workflow", "status"] as const) {
    if (returned[key] !== expected.filters[key]) throw mismatch();
  }
}

// Never lets a context from another scope reach the screen.
async function* withContextCheck(
  events: AsyncGenerator<AssistantEvent>,
  expected: ExpectedScope,
): AsyncGenerator<AssistantEvent> {
  for await (const event of events) {
    if (event.type === "start") assertContextMatches(event.data.context, expected);
    yield event;
  }
}

export interface AssistantAnswerStream {
  stream: ApiStreamResponse;
  events: AsyncGenerator<AssistantEvent>;
}

export async function askAssistant(args: {
  organizationId: string;
  projectId: string;
  question: string;
  selection: AssistantSelection;
  signal?: AbortSignal;
}): Promise<AssistantAnswerStream> {
  const { organizationId, projectId, question, selection, signal } = args;
  const body = buildAssistantBody(question, selection);

  const stream = await apiPostStream(
    "/organizations/" +
      encodeURIComponent(organizationId) +
      "/projects/" +
      encodeURIComponent(projectId) +
      "/assistant",
    body,
    { signal },
  );

  // A request we have already abandoned must not start being consumed.
  if (signal?.aborted) {
    await stream.body.cancel().catch(() => {});
    signal.throwIfAborted();
  }

  return {
    stream,
    events: withContextCheck(parseAssistantStream(stream.body), {
      projectId,
      from: body.from,
      to: body.to,
      filters: body.filters,
    }),
  };
}