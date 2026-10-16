import { ApiError } from "../../api/http-client";

export type TraceFailure =
  | { kind: "validation"; message: string }
  | { kind: "project-unavailable"; message: string }
  | { kind: "trace-not-found"; message: string }
  | { kind: "rate-limit"; message: string; retryAfterSeconds: number }
  | { kind: "error"; message: string };

/** Used when a 429 carries no usable Retry-After. */
export const RATE_LIMIT_COOLDOWN_SECONDS = 10;
const MAX_COOLDOWN_SECONDS = 3600;

export function classifyTraceFailure(error: unknown): TraceFailure {
  if (error instanceof ApiError) {
    const code = error.code;
    if (error.statusCode === 400) {
      const details = error.details?.flatMap(detail => detail.messages).join(" ");
      return { kind: "validation", message: details || error.message || "The filters were rejected." };
    }
    if (error.statusCode === 404 && code === "TRACE_NOT_FOUND") {
      return { kind: "trace-not-found", message: "This trace no longer exists." };
    }
    if (error.statusCode === 404) {
      return { kind: "project-unavailable", message: "This project is not available." };
    }
    if (error.statusCode === 429) {
      const wait = error.retryAfterSeconds;
      const retryAfterSeconds = wait === undefined ? RATE_LIMIT_COOLDOWN_SECONDS : Math.min(Math.max(wait, 1), MAX_COOLDOWN_SECONDS);
      return { kind: "rate-limit", message: "Too many requests. Please wait before trying again.", retryAfterSeconds };
    }
    return { kind: "error", message: error.message || "Failed to load traces." };
  }
  return { kind: "error", message: "Failed to load traces." };
}
