import { ApiError } from "../../api/http-client";

export type TraceFailure =
  | { kind: "validation"; message: string }
  | { kind: "project-unavailable"; message: string }
  | { kind: "trace-not-found"; message: string }
  | { kind: "rate-limit"; message: string }
  | { kind: "error"; message: string };

export const RATE_LIMIT_COOLDOWN_SECONDS = 10;

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
      return { kind: "rate-limit", message: "Too many requests. Please wait before trying again." };
    }
    return { kind: "error", message: error.message || "Failed to load traces." };
  }
  return { kind: "error", message: "Failed to load traces." };
}
