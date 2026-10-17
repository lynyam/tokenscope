import {
	getAuthSessionSnapshot,
	invalidateAuthSession,
	isAuthSessionCurrent,
} from "./auth-session";

const API_BASE_URL = "/api/v1";

export interface ApiErrorDetail {
	field: string;
	messages: string[];
}

export class ApiError extends Error {
	constructor(
		// Undefined means there is no usable HTTP status for this failure.
		public readonly statusCode: number | undefined,
		public readonly code: string,
		message: string,
		public readonly details?: ApiErrorDetail[],
		public readonly requestId?: string,
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

export interface UploadProgress {
	loaded: number;
	total?: number;
}

export interface UploadOptions extends ApiRequestOptions {
	onProgress?: (progress: UploadProgress) => void;
}

export interface ApiStreamResponse {
	body: ReadableStream<Uint8Array>;
	requestId?: string;
	isSessionCurrent(): boolean;
	invalidateSession(): void;
}

export function isAbortError(error: unknown): boolean {
	// DOMException can come from another browser realm.
	return (
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		error.name === "AbortError"
	);
}

export function getApiErrorMessage(
	error: unknown,
	fallback: string,
): string {
	return error instanceof ApiError ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value)
	);
}

function safeMessage(value: unknown): string | undefined {
	if (
		typeof value !== "string" ||
		value.trim().length === 0 ||
		value.length > 1000 ||
		/[<>\u0000-\u001f\u007f]/.test(value)
	) {
		return undefined;
	}

	return value;
}

function errorDetails(value: unknown): ApiErrorDetail[] | undefined {
	if (!Array.isArray(value)) return undefined;

	const details = value.filter(
		(item): item is ApiErrorDetail =>
			isRecord(item) &&
			typeof item.field === "string" &&
			Array.isArray(item.messages) &&
			item.messages.every(message => safeMessage(message) !== undefined),
	);

	return details.length > 0 ? details : undefined;
}

function mediaType(value: string | null): string | undefined {
	return value?.split(";")[0].trim().toLowerCase() || undefined;
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function parseRetryAfter(value: string | null): number | undefined {
	if (!value) return undefined;

	const trimmed = value.trim();

	if (/^\d+$/.test(trimmed)) {
		const seconds = Number(trimmed);
		return Number.isSafeInteger(seconds) ? seconds : undefined;
	}

	// HTTP-date form, for example: Wed, 21 Oct 2026 07:28:00 GMT.
	if (!/^[A-Za-z]{3}, /.test(trimmed)) return undefined;

	const date = Date.parse(trimmed);
	if (!Number.isFinite(date)) return undefined;

	return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function abortError(): DOMException {
	return new DOMException("The request was cancelled.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
	// Normalize custom abort reasons into the existing AbortError convention.
	if (signal?.aborted) throw abortError();
}

function networkError(): ApiError {
	return new ApiError(
		undefined,
		"NETWORK_ERROR",
		"Unable to reach the server. Please try again.",
	);
}

function throwTransportFailure(
	error: unknown,
	signal?: AbortSignal,
): never {
	if (isAbortError(error)) throw error;
	throwIfAborted(signal);
	throw networkError();
}

function invalidResponse(
	statusCode: number,
	requestId?: string,
): ApiError {
	return new ApiError(
		statusCode,
		"INVALID_API_RESPONSE",
		"The server returned an unexpected response.",
		undefined,
		requestId,
	);
}

function apiUrl(path: string): string {
	const invalidPath = () =>
		new ApiError(
			undefined,
			"INVALID_API_PATH",
			"The request must use an application API path.",
		);

	// Callers supply "/organizations/...", never a complete external URL.
	// Reject backslashes, fragments and unencoded whitespace/control characters.
	if (
		!path.startsWith("/") ||
		path.startsWith("//") ||
		/[\u0000-\u0020\u007f\\#]/.test(path)
	) {
		throw invalidPath();
	}

	const origin = window.location.origin;
	const url = new URL(`${API_BASE_URL}${path}`, origin);

	// URL normalization must not move the request outside the API prefix.
	if (
		url.origin !== origin ||
		!url.pathname.startsWith(`${API_BASE_URL}/`)
	) {
		throw invalidPath();
	}

	return `${url.pathname}${url.search}`;
}

function prepareRequest(
	path: string,
	options: ApiRequestOptions,
	accept: string,
) {
	throwIfAborted(options.signal);

	const url = apiUrl(path);

	// Capture once. Never replace this snapshot when the response arrives.
	const session =
		options.auth === "none" ? undefined : getAuthSessionSnapshot();

	const headers = new Headers({ Accept: accept });

	if (session?.token) {
		headers.set("Authorization", `Bearer ${session.token}`);
	}

	return { url, session, headers };
}

function httpError(
	status: number,
	body: unknown,
	requestId: string | undefined,
	retryAfter: string | null,
): ApiError {
	const envelope = isRecord(body) ? body : {};

	return new ApiError(
		// The actual HTTP status wins over any status in the JSON body.
		status,
		typeof envelope.code === "string" ? envelope.code : "HTTP_ERROR",
		safeMessage(envelope.message) ??
		"The request failed. Please try again.",
		errorDetails(envelope.details),
		typeof envelope.requestId === "string"
			? envelope.requestId
			: requestId,
		parseRetryAfter(retryAfter),
	);
}

function requireJsonValue<T>(
	body: unknown,
	status: number,
	requestId?: string,
): T {
	if (!isRecord(body) && !Array.isArray(body)) {
		throw invalidResponse(status, requestId);
	}

	// This validates the JSON container, not its domain fields.
	// Domain adapters remain responsible for resource-shape validation.
	return body as T;
}

async function discardResponse(response: Response): Promise<void> {
	try {
		await response.body?.cancel();
	} catch {
		// Cleanup must not replace the original response error.
	}
}

async function readJsonBody(
	response: Response,
	signal?: AbortSignal,
): Promise<unknown> {
	let text: string;

	try {
		text = await response.text();
	} catch (error) {
		throwTransportFailure(error, signal);
	}

	throwIfAborted(signal);
	return parseJson(text);
}

async function fetchApi(
	method: string,
	path: string,
	data: unknown,
	options: ApiRequestOptions,
	accept: string,
) {
	const { url, session, headers } = prepareRequest(path, options, accept);

	// Serialize outside the fetch catch: a programming error in the supplied
	// data must not be reported as a failed network connection.
	const body = data === undefined ? undefined : JSON.stringify(data);

	if (data !== undefined) {
		headers.set("Content-Type", "application/json");
	}

	let response: Response;

	try {
		response = await fetch(url, {
			method,
			headers,
			body,
			signal: options.signal,
			mode: "same-origin",
			redirect: "error",
			cache: "no-store",
		});
	} catch (error) {
		throwTransportFailure(error, options.signal);
	}

	// Authenticate from status before parsing a possibly malformed error body.
	if (response.status === 401 && session) {
		invalidateAuthSession(session);
	}

	if (options.signal?.aborted) {
		await discardResponse(response);
		throw abortError();
	}

	const requestId = response.headers.get("X-Request-Id") ?? undefined;

	// Defensive checks; native fetch already rejects redirects with the policy
	// above. A redirected/fallback page must never become an API success.
	if (response.redirected || response.type === "opaqueredirect") {
		await discardResponse(response);
		throw invalidResponse(response.status, requestId);
	}

	if (!response.ok) {
		let errorBody: unknown;

		if (mediaType(response.headers.get("Content-Type")) === "application/json") {
			try {
				errorBody = await readJsonBody(response, options.signal);
			} catch (error) {
				if (isAbortError(error)) throw error;

				// Preserve the HTTP failure even if its body cannot be read.
			}
		} else {
			await discardResponse(response);
		}

		throw httpError(
			response.status,
			errorBody,
			requestId,
			response.headers.get("Retry-After"),
		);
	}

	return { response, session };
}

// Shared JSON entry point. TSE-66 can use it for DELETE + confirmation body.
// Existing convenience exports below keep their current signatures.
export async function request<T>(
	method: string,
	path: string,
	data: unknown,
	options: ApiRequestOptions = {},
	emptyResponse = false,
): Promise<T> {
	const { response } = await fetchApi(
		method,
		path,
		data,
		options,
		"application/json",
	);

	const requestId = response.headers.get("X-Request-Id") ?? undefined;

	if (emptyResponse && response.status === 204) {
		return undefined as T;
	}

	if (
		emptyResponse ||
		mediaType(response.headers.get("Content-Type")) !== "application/json"
	) {
		await discardResponse(response);
		throw invalidResponse(response.status, requestId);
	}

	const body = await readJsonBody(response, options.signal);
	return requireJsonValue<T>(body, response.status, requestId);
}

export function apiGet<T>(
	path: string,
	options: ApiRequestOptions = {},
): Promise<T> {
	return request<T>("GET", path, undefined, options);
}

export function apiPost<T>(
	path: string,
	body: unknown,
	options: ApiRequestOptions = {},
): Promise<T> {
	return request<T>("POST", path, body, options);
}

export function apiPatch<T>(
	path: string,
	body: unknown,
	options: ApiRequestOptions = {},
): Promise<T> {
	return request<T>("PATCH", path, body, options);
}

export function apiDelete(
	path: string,
	options: ApiRequestOptions = {},
): Promise<void> {
	return request<void>("DELETE", path, undefined, options, true);
}

export async function requestBlob(
	path: string,
	options: ApiRequestOptions = {},
): Promise<Blob> {
	const { response } = await fetchApi(
		"GET",
		path,
		undefined,
		options,
		"*/*",
	);

	const requestId = response.headers.get("X-Request-Id") ?? undefined;
	const type = mediaType(response.headers.get("Content-Type"));

	if (
		response.status !== 200 ||
		!response.body ||
		!type ||
		type === "text/html" ||
		type === "application/xhtml+xml"
	) {
		await discardResponse(response);
		throw invalidResponse(response.status, requestId);
	}

	let blob: Blob;

	try {
		blob = await response.blob();
	} catch (error) {
		throwTransportFailure(error, options.signal);
	}

	throwIfAborted(options.signal);

	// Keep the server's media type. The document adapter/UI checks whether
	// the returned PDF/text type is appropriate for the selected document.
	return blob;
}

export async function apiPostStream(
	path: string,
	data: unknown,
	options: ApiRequestOptions = {},
): Promise<ApiStreamResponse> {
	const { response, session } = await fetchApi(
		"POST",
		path,
		data,
		options,
		"text/event-stream",
	);

	const requestId = response.headers.get("X-Request-Id") ?? undefined;

	if (
		response.status !== 200 ||
		mediaType(response.headers.get("Content-Type")) !== "text/event-stream" ||
		!response.body ||
		response.bodyUsed ||
		response.body.locked
	) {
		await discardResponse(response);
		throw invalidResponse(response.status, requestId);
	}

	// Do not read, decode or clone the successful stream here.
	// The original fetch signal remains effective during body consumption.
	return {
		body: response.body,
		requestId,
		isSessionCurrent: () =>
			session === undefined || isAuthSessionCurrent(session),
		invalidateSession: () => {
			if (session) invalidateAuthSession(session);
		},
	};
}

export async function uploadMultipart<T>(
	path: string,
	body: FormData,
	options: UploadOptions = {},
): Promise<T> {
	const { url, session, headers } = prepareRequest(
		path,
		options,
		"application/json",
	);

	const expectedResponseUrl = new URL(url, window.location.origin).href;
	const xhr = new XMLHttpRequest();

	return new Promise<T>((resolve, reject) => {
		let settled = false;

		function cleanup(): void {
			xhr.removeEventListener("load", onLoad);
			xhr.removeEventListener("error", onError);
			xhr.removeEventListener("abort", onAbort);
			xhr.removeEventListener("timeout", onTimeout);
			xhr.upload.removeEventListener("progress", onProgress);
			options.signal?.removeEventListener("abort", onSignalAbort);
		}

		function succeed(value: T): void {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(value);
		}

		function fail(error: unknown): void {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		}

		function onLoad(): void {
			if (settled) return;

			try {
				const status = xhr.status;

				if (status === 401 && session) {
					invalidateAuthSession(session);
				}

				// Session invalidation can cause the owning screen to abort.
				if (settled) return;

				if (status === 0) {
					fail(networkError());
					return;
				}

				const requestId = xhr.getResponseHeader("X-Request-Id") ?? undefined;

				// XHR follows redirects. This detects an unexpected final destination;
				// it is not a mechanism that prevents the redirect from occurring.
				if (xhr.responseURL !== expectedResponseUrl) {
					fail(invalidResponse(status, requestId));
					return;
				}

				const isJson =
					mediaType(xhr.getResponseHeader("Content-Type")) === "application/json";

				const parsed = isJson ? parseJson(xhr.responseText) : undefined;

				if (status < 200 || status >= 300) {
					fail(
						httpError(
							status,
							parsed,
							requestId,
							xhr.getResponseHeader("Retry-After"),
						),
					);
					return;
				}

				if (!isJson) {
					fail(invalidResponse(status, requestId));
					return;
				}

				succeed(requireJsonValue<T>(parsed, status, requestId));
			} catch (error) {
				fail(error);
			}
		}

		function onError(): void {
			fail(options.signal?.aborted ? abortError() : networkError());
		}

		function onAbort(): void {
			fail(abortError());
		}

		function onTimeout(): void {
			fail(
				new ApiError(
					undefined,
					"REQUEST_TIMEOUT",
					"The request timed out. Please try again.",
				),
			);
		}

		function onSignalAbort(): void {
			if (settled) return;

			// Settle and detach first, so xhr.abort() cannot trigger a second result.
			fail(abortError());
			xhr.abort();
		}

		function onProgress(event: ProgressEvent): void {
			if (settled || !options.onProgress) return;

			try {
				options.onProgress({
					loaded: event.loaded,
					...(event.lengthComputable ? { total: event.total } : {}),
				});
			} catch (error) {
				// A synchronous UI callback failure must not leave an upload dangling.
				fail(error);
				xhr.abort();
			}
		}

		// Register before sending, including upload progress listeners.
		xhr.addEventListener("load", onLoad);
		xhr.addEventListener("error", onError);
		xhr.addEventListener("abort", onAbort);
		xhr.addEventListener("timeout", onTimeout);
		xhr.upload.addEventListener("progress", onProgress);
		options.signal?.addEventListener("abort", onSignalAbort, { once: true });

		// Covers cancellation between preparation and listener registration.
		if (options.signal?.aborted) {
			onSignalAbort();
			return;
		}

		try {
			xhr.open("POST", url);

			headers.forEach((value, name) => {
				xhr.setRequestHeader(name, value);
			});

			// Never set Content-Type here. The browser supplies the multipart boundary.
			// Progress reaching 100% does not resolve this promise; onLoad does.
			xhr.send(body);
		} catch (error) {
			fail(
				isAbortError(error) || options.signal?.aborted
					? abortError()
					: networkError(),
			);
			xhr.abort();
		}
	});
}
