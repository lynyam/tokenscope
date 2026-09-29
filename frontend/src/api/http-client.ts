import { ApiError, ApiErrorResponse } from "./api-error";

/**
 * The single place that knows: the API base path, how to attach the
 * bearer token, and how to turn a failed response into a throwable
 * ApiError. Every *.api.ts file should call THIS, never fetch()
 * directly — per SPRINT_1_ARCHITECTURE.md: "Pages call files in api/;
 * pages do not call fetch directly."
 */

const API_BASE = "/api/v1";

// Centralized here so every *.api.ts file agrees on exactly one
// storage key/mechanism for the access token.
const TOKEN_STORAGE_KEY = "tokenscope_access_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  // Explicit opt-out for signup/signin, which have no token yet.
  skipAuth?: boolean;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, skipAuth = false } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (!skipAuth) {
    const token = getStoredToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // 204 No Content (e.g. archiveProject, removeMember) has no body.
  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json();

  if (!response.ok) {
    // Throw the real, catchable ApiError — built from the parsed
    // ApiErrorResponse JSON — not the raw data or a generic Error.
    throw new ApiError(data as ApiErrorResponse);
  }

  return data as T;
}