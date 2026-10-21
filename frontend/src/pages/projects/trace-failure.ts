import { ApiError } from "../../api/http-client";

export type TraceFailure = { requestId?: string } & (
  | { kind: "validation"; message: string }
  | { kind: "project-unavailable"; message: string }
  | { kind: "trace-not-found"; message: string }
  | { kind: "rate-limit"; message: string; retryAfterSeconds: number }
  | { kind: "error"; message: string }
);

/** Used when a 429 carries no usable Retry-After. */
export const RATE_LIMIT_COOLDOWN_SECONDS = 10;

export function classifyTraceFailure(error: unknown): TraceFailure {
  if (error instanceof ApiError) {
    const context = { requestId: error.requestId };

    if (error.statusCode === 400) {
      const details = error.details
        ?.flatMap(detail => detail.messages)
        .join(" ");

      return {
        ...context,
        kind: "validation",
        message: details || error.message || "The filters were rejected.",
      };
    }

    if (
      error.statusCode === 404 &&
      error.code === "TRACE_NOT_FOUND"
    ) {
      return {
        ...context,
        kind: "trace-not-found",
        message: "This trace no longer exists.",
      };
    }

    if (error.statusCode === 404) {
      return {
        ...context,
        kind: "project-unavailable",
        message: "This project is not available.",
      };
    }

    if (error.statusCode === 429) {
      return {
        ...context,
        kind: "rate-limit",
        message: "Too many requests. Please wait before trying again.",
        retryAfterSeconds:
          error.retryAfterSeconds ?? RATE_LIMIT_COOLDOWN_SECONDS,
      };
    }

    return {
      ...context,
      kind: "error",
      message: error.message || "Failed to load traces.",
    };
  }

  return { kind: "error", message: "Failed to load traces." };
}
