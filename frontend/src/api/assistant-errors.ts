import { ApiError } from "./http-client";
import { AssistantStreamError } from "./assistant-stream";
import { AssistantRequestError } from "./assistant.api";
import type { ErrorPayload } from "../types/assistant.types";

export type AssistantFailure = {
  // "interrupted" = connection problem; "failed" = everything else.
  kind: "failed" | "interrupted";
  message: string;
  // Protected content must be removed (access lost).
  clearContent: boolean;
  // Keep the partial answer, labelled incomplete.
  keepPartial: boolean;
  // Tell the dashboard that the project is unavailable.
  notifyProjectUnavailable: boolean;
  // Invalidate the session that started the request (and only that one).
  invalidateSession: boolean;
  // Seconds to wait before another submission is allowed.
  waitSeconds?: number;
  requestId?: string;
};

type Info = {
  code?: string;
  statusCode?: number;
  requestId?: string;
  retryAfterSeconds?: number;
};

function build(
  kind: AssistantFailure["kind"],
  message: string,
  flags: Partial<AssistantFailure> = {},
): AssistantFailure {
  return {
    kind,
    message,
    clearContent: false,
    keepPartial: true,
    notifyProjectUnavailable: false,
    invalidateSession: false,
    ...flags,
  };
}

function rateLimitedMessage(seconds?: number): string {
  if (seconds === undefined) {
    return "Too many requests. Please wait a moment before trying again.";
  }
  return (
    "Too many requests. Try again in " +
    seconds +
    (seconds === 1 ? " second." : " seconds.")
  );
}

function describeByCode(info: Info): AssistantFailure {
  const { code, statusCode, requestId, retryAfterSeconds } = info;
  const withId = (failure: AssistantFailure): AssistantFailure =>
    requestId ? { ...failure, requestId } : failure;

  // Authentication lost: only the captured session is invalidated.
  if (code === "ACCESS_TOKEN_EXPIRED" || statusCode === 401) {
    return withId(
      build("failed", "Your session has expired. Please sign in again.", {
        clearContent: true,
        keepPartial: false,
        invalidateSession: true,
      }),
    );
  }

  // Project gone or no longer accessible: the session stays valid.
  if (code === "PROJECT_NOT_FOUND" || statusCode === 404) {
    return withId(
      build("failed", "This project is no longer available.", {
        clearContent: true,
        keepPartial: false,
        notifyProjectUnavailable: true,
      }),
    );
  }

  // Defensive: the backend answers 404 for denied access, never 403.
  if (statusCode === 403) {
    return withId(
      build("failed", "You no longer have access to this project.", {
        clearContent: true,
        keepPartial: false,
      }),
    );
  }

  switch (code) {
    case "VALIDATION_ERROR":
      return withId(
        build(
          "failed",
          "The request was not accepted. Check your question and the selected period and filters.",
        ),
      );
    case "PAYLOAD_TOO_LARGE":
      return withId(
        build("failed", "The request is too large. Please shorten your question."),
      );
    case "ASSISTANT_NO_DATA":
      return withId(build("failed", "No traces currently match this selection."));
    case "ASSISTANT_CONTEXT_TOO_LARGE":
      return withId(
        build(
          "failed",
          "This selection contains too much data for the assistant. Narrow the dates or filters.",
        ),
      );
    case "LLM_REFUSED":
      return withId(build("failed", "The assistant could not answer this request."));
    case "ASSISTANT_ALREADY_RUNNING":
      return withId(
        build(
          "failed",
          "Another assistant request is already running. Wait for it to finish, then try again.",
        ),
      );
    case "RATE_LIMITED":
      return withId(
        build("failed", rateLimitedMessage(retryAfterSeconds), {
          waitSeconds: retryAfterSeconds,
        }),
      );
    case "LLM_UNAVAILABLE":
      return withId(build("failed", "The assistant is currently unavailable."));
    case "LLM_PROVIDER_BUSY":
      return withId(
        build(
          "failed",
          "The assistant provider is temporarily at capacity. Please try again later.",
        ),
      );
    case "LLM_PROVIDER_ERROR":
    case "LLM_TIMEOUT":
    case "INTERNAL_SERVER_ERROR":
      return withId(
        build(
          "failed",
          "The assistant could not complete the answer. Any text shown is incomplete.",
        ),
      );
    case "NETWORK_ERROR":
      return withId(
        build(
          "interrupted",
          "Unable to reach the server. Any text shown is incomplete.",
        ),
      );
  }

  // Unknown code: fall back on the HTTP status when there is one.
  if (statusCode === 429) {
    return withId(
      build("failed", rateLimitedMessage(retryAfterSeconds), {
        waitSeconds: retryAfterSeconds,
      }),
    );
  }

  return withId(
    build("failed", "The assistant could not complete the answer. Any text shown is incomplete."),
  );
}

// Any error thrown while asking or reading the answer.
// Deliberate aborts (Stop, navigation) must be filtered out BEFORE calling this.
export function describeAssistantError(error: unknown): AssistantFailure {
  if (error instanceof ApiError) {
    return describeByCode({
      code: error.code,
      statusCode: error.statusCode,
      requestId: error.requestId,
      retryAfterSeconds: error.retryAfterSeconds,
    });
  }

  if (error instanceof AssistantStreamError) {
    if (error.kind === "interrupted") {
      return build(
        "interrupted",
        "The connection was interrupted. The answer shown is incomplete.",
      );
    }
    return build(
      "failed",
      "The assistant returned an invalid response. Any text shown is incomplete.",
    );
  }

  if (error instanceof AssistantRequestError) {
    return build("failed", error.message);
  }

  return build(
    "failed",
    "The assistant could not complete the answer. Any text shown is incomplete.",
  );
}

// The terminal "error" event received inside the stream (HTTP status was 200).
export function describeStreamErrorEvent(payload: ErrorPayload): AssistantFailure {
  return describeByCode({ code: payload.code, requestId: payload.requestId });
}