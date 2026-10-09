import { getAuthSessionSnapshot, invalidateAuthSession } from "./auth-session";

const API_BASE_URL = "/api/v1";

export interface ApiErrorDetail {
  field: string;
  messages: string[];
}

export class ApiError extends Error {
  constructor(
    // Undefined means no HTTP response was received (for example, offline).
    public readonly statusCode: number | undefined,
    public readonly code: string,
    message: string,
    public readonly details?: ApiErrorDetail[],
    public readonly requestId?: string,
    // Seconds to wait before retrying (from the Retry-After header, if any).
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiRequestOptions {
  auth?: "required" | "none";
  signal?: AbortSignal;
}

export function isAbortError(error: unknown): boolean {
  // DOMException may come from another browser realm and fail instanceof Error.
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorDetails(value: unknown): ApiErrorDetail[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const details = value.filter((item): item is ApiErrorDetail =>
    isRecord(item) && typeof item.field === "string" &&
    Array.isArray(item.messages) && item.messages.every(message => typeof message === "string"),
  );
  return details.length ? details : undefined;
}

async function request<T>(
  method: string,
  path: string,
  data: unknown,
  options: ApiRequestOptions,
  emptyResponse = false,
): Promise<T> {
  const session = options.auth !== "none" ? getAuthSessionSnapshot() : undefined;
  const headers = new Headers({ Accept: "application/json" });
  if (data !== undefined) headers.set("Content-Type", "application/json");
  if (session?.token) headers.set("Authorization", `Bearer ${session.token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(undefined, "NETWORK_ERROR", "Unable to reach the server. Please try again.");
  }

  // HTTP status governs authentication even if a proxy returns a non-JSON body.
  if (response.status === 401 && session) invalidateAuthSession(session);

  const requestId = response.headers.get("X-Request-Id") ?? undefined;
  if (response.ok && emptyResponse && response.status === 204) return undefined as T;

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
  }

  if (!response.ok) {
    const envelope = isRecord(body) ? body : {};
    throw new ApiError(
      response.status,
      typeof envelope.code === "string" ? envelope.code : "HTTP_ERROR",
      typeof envelope.message === "string" ? envelope.message : "The request failed. Please try again.",
      errorDetails(envelope.details),
      typeof envelope.requestId === "string" ? envelope.requestId : requestId,
    );
  }

  const isJson = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() === "application/json";
  if (emptyResponse || !isJson || (!isRecord(body) && !Array.isArray(body))) {
    throw new ApiError(response.status, "INVALID_API_RESPONSE", "The server returned an unexpected response.", undefined, requestId);
  }

  // The transport checks JSON; domain response shapes are proved by adapter tests.
  // A generic type parameter by itself is not runtime validation.
  return body as T;
}

export function apiGet<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return request<T>("GET", path, undefined, options);
}

export function apiPost<T>(path: string, body: unknown, options: ApiRequestOptions = {}): Promise<T> {
  return request<T>("POST", path, body, options);
}

export function apiPatch<T>(path: string, body: unknown, options: ApiRequestOptions = {}): Promise<T> {
  return request<T>("PATCH", path, body, options);
}

export function apiDelete(path: string, options: ApiRequestOptions = {}): Promise<void> {
  return request<void>("DELETE", path, undefined, options, true);
}

// ---------------------------------------------------------------------------
// Streamed POST (Server-Sent Events). Added for the dashboard assistant.
// ---------------------------------------------------------------------------

export interface ApiStreamResponse {
  body: ReadableStream<Uint8Array>;
  requestId?: string;
  // True while the session that started the request is still the current one.
  isSessionCurrent(): boolean;
  // Invalidates the session that started the request (never a newer one).
  invalidateSession(): void;
}

// Retry-After may be a number of seconds or an HTTP date.
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

export async function apiPostStream(
  path: string,
  data: unknown,
  options: ApiRequestOptions = {},
): Promise<ApiStreamResponse> {
  // The session is captured ONCE, when the request starts.
  const session = options.auth !== "none" ? getAuthSessionSnapshot() : undefined;
  const headers = new Headers({
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  });
  if (session?.token) headers.set("Authorization", `Bearer ${session.token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(undefined, "NETWORK_ERROR", "Unable to reach the server. Please try again.");
  }

  // HTTP status governs authentication even if a proxy returns a non-JSON body.
  if (response.status === 401 && session) invalidateAuthSession(session);

  const requestId = response.headers.get("X-Request-Id") ?? undefined;

  // Error before the stream starts: normal JSON error envelope.
  if (!response.ok) {
    let errorBody: unknown;
    try {
      errorBody = await response.json();
    } catch (error) {
      if (isAbortError(error)) throw error;
    }
    const envelope = isRecord(errorBody) ? errorBody : {};
    throw new ApiError(
      response.status,
      typeof envelope.code === "string" ? envelope.code : "HTTP_ERROR",
      typeof envelope.message === "string" ? envelope.message : "The request failed. Please try again.",
      errorDetails(envelope.details),
      typeof envelope.requestId === "string" ? envelope.requestId : requestId,
      parseRetryAfter(response.headers.get("Retry-After")),
    );
  }

  // Success: the contract requires 200, the SSE content type and a readable body.
  const contentType = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (response.status !== 200 || contentType !== "text/event-stream" || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new ApiError(
      response.status,
      "INVALID_API_RESPONSE",
      "The server returned an unexpected response.",
      undefined,
      requestId,
    );
  }

  // The stream is returned as is: no response.json() or response.text().
  return {
    body: response.body,
    requestId,
    isSessionCurrent: () => (session ? getAuthSessionSnapshot() === session : true),
    invalidateSession: () => {
      if (session) invalidateAuthSession(session);
    },
  };
}