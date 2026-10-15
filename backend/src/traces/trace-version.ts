import type { Request } from "express";
import { ApiException } from "../common/errors/api.exception";
import { invalidUsage } from "../common/validation/usage-values";

export const MAX_TRACE_VERSION = 2_147_483_647;

export function traceEtag(version: number): string {
  return `"${version}"`;
}

export function singleIfMatch(request: Request): string | undefined {
  let count = 0;

  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === "if-match") {
      count += 1;
    }
  }

  if (count > 1) {
    invalidUsage("If-Match", "Supply exactly one If-Match header.");
  }

  const value = request.headers["if-match"];

  if (value !== undefined && typeof value !== "string") {
    invalidUsage("If-Match", "Supply exactly one If-Match header.");
  }

  return value;
}

export function parseTraceVersion(value: string | undefined): number {
  if (value === undefined) {
    throw new ApiException(
      428,
      "TRACE_VERSION_REQUIRED",
      "Supply the trace ETag in If-Match.",
    );
  }

  const match = /^"([1-9]\d*)"$/.exec(value);

  if (!match) {
    invalidUsage("If-Match", 'Use one quoted positive integer, such as "1".');
  }

  const version = Number(match[1]);

  if (
    !Number.isSafeInteger(version) ||
    version > MAX_TRACE_VERSION
  ) {
    invalidUsage("If-Match", "Unsupported trace version.");
  }

  return version;
}

export function assertTraceVersion(
  current: number,
  expected: number,
): void {
  if (current !== expected) {
    throw new ApiException(
      412,
      "TRACE_VERSION_CONFLICT",
      "The trace changed. Read it again before deciding on a correction.",
    );
  }
}

export function assertVersionCanAdvance(version: number): void {
  if (version >= MAX_TRACE_VERSION) {
    throw new ApiException(
      409,
      "TRACE_VERSION_EXHAUSTED",
      "This trace cannot accept further mutations.",
    );
  }
}