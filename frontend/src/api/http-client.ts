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
