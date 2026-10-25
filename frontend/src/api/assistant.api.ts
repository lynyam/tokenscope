import { commonFilters, parseTraceSearchParams, validatePeriod } from "./trace-filters";
import { apiPostStream } from "./http-client";
import type { ApiStreamResponse } from "./http-client";
import { AssistantStreamError, parseAssistantStream } from "./assistant-stream";
import type {
  AssistantContext,
  AskAssistantRequest,
  AssistantEvent,
  AssistantFilters,
  AssistantSelection,
} from "../types/assistant.types";

export const MAX_QUESTION_LENGTH = 2000;
export const MAX_BODY_BYTES = 8 * 1024;

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
  if ([...trimmed].length > MAX_QUESTION_LENGTH) return "too-long";
  return null;
}

// Delegate filtering to the same parser used by the dashboard and Explorer.
// Its default dates are irrelevant here: only the normalized filter fields are returned.
export function normalizeFilters(filters: Record<string, unknown>): AssistantFilters {
  const params = new URLSearchParams();
  for (const key of ["q", "provider", "model", "workflow", "status"] as const) {
    const value = filters[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") {
      throw new AssistantRequestError("invalid-selection", "The selected filters are invalid.");
    }
    if (value.trim() === "") continue;
    params.set(key, value);
  }
  const parsed = parseTraceSearchParams(params);
  if (!parsed.ok) throw new AssistantRequestError("invalid-selection", parsed.errors.join(" "));
  const { from: _from, to: _to, ...normalized } = commonFilters(parsed.query);
  return normalized;
}

function assertValidSelection(selection: AssistantSelection): void {
  const error = validatePeriod(selection.from, selection.to);
  if (error) throw new AssistantRequestError("invalid-selection", error);
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
  if ([...trimmed].length > MAX_QUESTION_LENGTH) {
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

function sameInstant(value: unknown, expected: string): boolean {
  return typeof value === "string" && Date.parse(value) === Date.parse(expected);
}

type ExpectedScope = {
  projectId: string;
  from: string;
  to: string;
  filters: AssistantFilters;
};

// The parser validates the shape; this binds the context to this exact request.
function assertContextMatches(
  context: AssistantContext,
  expected: ExpectedScope,
): void {
  const mismatch = () =>
    new AssistantStreamError("protocol", "The returned context does not match the request.");

  if (context.project.id !== expected.projectId) {
    throw mismatch();
  }
  if (
    !sameInstant(context.window.from, expected.from) ||
    !sameInstant(context.window.to, expected.to)
  ) {
    throw mismatch();
  }
  for (const key of ["q", "provider", "model", "workflow", "status"] as const) {
    if ((context.filters[key] ?? undefined) !== expected.filters[key]) throw mismatch();
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