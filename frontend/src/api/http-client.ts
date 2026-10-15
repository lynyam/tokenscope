import { getAuthSessionSnapshot, invalidateAuthSession, type AuthSessionSnapshot } from "./auth-session";

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

function apiUrl(path: string): string {
  // Bearer credentials must only ever reach this application's own API.
  // Reject absolute, protocol-relative, backslash and whitespace/control forms.
  if (typeof path !== "string" || !/^\/(?![/\\])[^\\\u0000-\u0020\u007f]*$/.test(path)) {
    throw new TypeError("API paths must be same-origin absolute paths such as /organizations.");
  }
  return `${API_BASE_URL}${path}`;
}

function captureSession(options: ApiRequestOptions): AuthSessionSnapshot | undefined {
  return options.auth !== "none" ? getAuthSessionSnapshot() : undefined;
}

function requestHeaders(accept: string, session: AuthSessionSnapshot | undefined): Headers {
  const headers = new Headers({ Accept: accept });
  if (session?.token) headers.set("Authorization", `Bearer ${session.token}`);
  return headers;
}

function networkError(): ApiError {
  return new ApiError(undefined, "NETWORK_ERROR", "Unable to reach the server. Please try again.");
}

function invalidResponse(statusCode: number, requestId?: string): ApiError {
  return new ApiError(statusCode, "INVALID_API_RESPONSE", "The server returned an unexpected response.", undefined, requestId);
}

function mediaType(contentType: string | null): string {
  return contentType?.split(";")[0].trim().toLowerCase() ?? "";
}

function apiErrorFromBody(statusCode: number, body: unknown, headerRequestId: string | null | undefined): ApiError {
  const envelope = isRecord(body) ? body : {};
  return new ApiError(
    statusCode,
    typeof envelope.code === "string" ? envelope.code : "HTTP_ERROR",
    typeof envelope.message === "string" ? envelope.message : "The request failed. Please try again.",
    errorDetails(envelope.details),
    typeof envelope.requestId === "string" ? envelope.requestId : headerRequestId ?? undefined,
  );
}

// HTTP status governs authentication even if a proxy returns a non-JSON body.
function invalidateOn401(status: number, session: AuthSessionSnapshot | undefined): void {
  if (status === 401 && session) invalidateAuthSession(session);
}

// A redirect is never a valid private-API result (for example a login page).
function isRedirect(response: Response): boolean {
  return response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
}

async function failedResponse(response: Response, session: AuthSessionSnapshot | undefined): Promise<ApiError> {
  invalidateOn401(response.status, session);
  const requestId = response.headers.get("X-Request-Id");
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
  }
  return apiErrorFromBody(response.status, body, requestId);
}

async function discardBody(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* Nothing useful remains to release. */ }
}

async function fetchApi(
  url: string,
  init: RequestInit,
  session: AuthSessionSnapshot | undefined,
  options: ApiRequestOptions,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: options.signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw networkError();
  }
  if (isRedirect(response)) {
    invalidateOn401(response.status, session);
    await discardBody(response);
    throw invalidResponse(response.status);
  }
  return response;
}

async function request<T>(
  method: string,
  path: string,
  data: unknown,
  options: ApiRequestOptions,
  emptyResponse = false,
): Promise<T> {
  const url = apiUrl(path);
  const session = captureSession(options);
  const headers = requestHeaders("application/json", session);
  if (data !== undefined) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw networkError();
  }

  invalidateOn401(response.status, session);

  const requestId = response.headers.get("X-Request-Id") ?? undefined;
  if (response.ok && emptyResponse && response.status === 204) return undefined as T;

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
  }

  if (!response.ok) throw apiErrorFromBody(response.status, body, requestId);

  if (emptyResponse || mediaType(response.headers.get("Content-Type")) !== "application/json" ||
      (!isRecord(body) && !Array.isArray(body))) {
    throw invalidResponse(response.status, requestId);
  }

  // The transport checks JSON; domain response shapes are proved by adapter tests.
  // A generic type parameter by itself is not runtime validation.
  return body as T;
}

/**
 * Authenticated GET returning the raw bytes of a private file.
 * Creating object URLs, previews and downloads (and revoking them) belongs to the caller.
 */
export async function requestBlob(path: string, options: ApiRequestOptions = {}): Promise<Blob> {
  const url = apiUrl(path);
  const session = captureSession(options);
  // "manual" lets a login/SSO redirect be detected instead of followed with credentials.
  const response = await fetchApi(url, {
    method: "GET",
    headers: requestHeaders("*/*", session),
    redirect: "manual",
  }, session, options);

  if (!response.ok) throw await failedResponse(response, session);

  const requestId = response.headers.get("X-Request-Id") ?? undefined;
  // A login or SPA fallback page is never a private document.
  if (mediaType(response.headers.get("Content-Type")) === "text/html") {
    await discardBody(response);
    throw invalidResponse(response.status, requestId);
  }

  try {
    return await response.blob();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw networkError();
  }
}

export interface StreamResponse {
  /** Successful `text/event-stream` response. Its body has not been read. */
  readonly response: Response;
  /**
   * Invalidates only the session that opened this stream, and only if it is still current.
   * Use it for an `ACCESS_TOKEN_EXPIRED` event received after the stream started.
   * It is a no-op for requests opened with `auth: "none"`.
   */
  readonly invalidateSession: () => void;
}

/**
 * Authenticated JSON POST whose successful response body stays readable incrementally.
 * Decoding and parsing the event stream belongs to the caller.
 */
export async function requestStream(
  path: string,
  body: unknown,
  options: ApiRequestOptions = {},
): Promise<StreamResponse> {
  const url = apiUrl(path);
  const session = captureSession(options);
  const headers = requestHeaders("text/event-stream", session);
  headers.set("Content-Type", "application/json");
  const response = await fetchApi(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "manual",
  }, session, options);

  if (!response.ok) throw await failedResponse(response, session);

  const requestId = response.headers.get("X-Request-Id") ?? undefined;
  if (mediaType(response.headers.get("Content-Type")) !== "text/event-stream" || !response.body) {
    await discardBody(response);
    throw invalidResponse(response.status, requestId);
  }

  return {
    response,
    invalidateSession: () => { if (session) invalidateAuthSession(session); },
  };
}

export interface UploadProgress {
  /** Bytes the browser reports as sent. */
  loaded: number;
  /** Present only when the browser can compute the request length; otherwise progress is indeterminate. */
  total?: number;
}

export type UploadOptions = ApiRequestOptions & {
  onProgress?: (progress: UploadProgress) => void;
};

function abortError(): DOMException {
  return new DOMException("The upload was cancelled.", "AbortError");
}

/**
 * Authenticated multipart POST with measured upload progress (XHR is the only browser API that
 * reports upload progress). Resolves only after a successful JSON HTTP response: reaching
 * `loaded === total` means the bytes were sent, not that the server saved them.
 */
export function uploadMultipart<T>(path: string, body: FormData, options: UploadOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let url: string;
    try {
      url = apiUrl(path);
      if (!(body instanceof FormData)) throw new TypeError("uploadMultipart requires a FormData body.");
    } catch (error) {
      reject(error);
      return;
    }
    const { signal, onProgress } = options;
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const session = captureSession(options);
    const xhr = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      xhr.upload.onprogress = null;
      xhr.onload = null;
      xhr.onerror = null;
      xhr.onabort = null;
      xhr.ontimeout = null;
    };
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      finish();
    };
    function onAbort() {
      settle(() => reject(abortError()));
      xhr.abort(); // Handlers are already removed, so this cannot settle a second time.
    }

    xhr.open("POST", url);
    xhr.setRequestHeader("Accept", "application/json");
    if (session?.token) xhr.setRequestHeader("Authorization", `Bearer ${session.token}`);
    // No Content-Type: the browser adds multipart/form-data with its boundary.

    xhr.upload.onprogress = event => {
      if (settled || !onProgress) return;
      const progress: UploadProgress = event.lengthComputable
        ? { loaded: event.loaded, total: event.total }
        : { loaded: event.loaded };
      try { onProgress(progress); } catch { /* A faulty observer must not change the upload outcome. */ }
    };
    xhr.onload = () => settle(() => {
      invalidateOn401(xhr.status, session);
      const requestId = xhr.getResponseHeader("X-Request-Id");
      let parsed: unknown;
      try { parsed = JSON.parse(xhr.responseText); } catch { /* Handled below. */ }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(apiErrorFromBody(xhr.status, parsed, requestId));
      } else if (mediaType(xhr.getResponseHeader("Content-Type")) !== "application/json" ||
                 (!isRecord(parsed) && !Array.isArray(parsed))) {
        reject(invalidResponse(xhr.status, requestId ?? undefined));
      } else {
        resolve(parsed as T);
      }
    });
    xhr.onerror = () => settle(() => reject(networkError()));
    xhr.ontimeout = () => settle(() => reject(networkError()));
    xhr.onabort = () => settle(() => reject(abortError()));
    signal?.addEventListener("abort", onAbort, { once: true });

    xhr.send(body);
  });
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
