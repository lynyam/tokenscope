import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	apiGet,
	apiPostStream,
	request,
	requestBlob,
	uploadMultipart,
	type ApiRequestOptions,
	type ApiStreamResponse,
} from "@/api/http-client";

import {
	getAccessToken,
	getAuthSessionSnapshot,
	invalidateAuthSession,
	isAuthSessionCurrent,
	saveAccessToken,
} from "@/api/auth-session";

import { FakeXHR, lastXHR } from "./helpers/fake-xhr";

type Kind = "json" | "blob" | "stream" | "upload";

const kinds: Kind[] = ["json", "blob", "stream", "upload"];
const fetchMock = vi.fn<typeof fetch>();
const pendingResponses: Array<(response: Response) => void> = [];

const path = "/organizations/org/projects/project/example";

function start(
	kind: Kind,
	target = path,
	options: ApiRequestOptions = {},
): Promise<unknown> {
	switch (kind) {
		case "json":
			return apiGet(target, options);
		case "blob":
			return requestBlob(target, options);
		case "stream":
			return apiPostStream(target, { question: "Explain this period." }, options);
		case "upload":
			return uploadMultipart(target, new FormData(), options);
	}
}

function reply(
	kind: Kind,
	status: number,
	body: string | null,
	contentType = "application/json",
	extraHeaders: Record<string, string> = {},
): void {
	const headers = {
		"Content-Type": contentType,
		...extraHeaders,
	};

	if (kind === "upload") {
		lastXHR().respond(status, body ?? "", headers);
		return;
	}

	const complete = pendingResponses.shift();

	if (!complete) {
		throw new Error("The test expected a pending fetch request.");
	}

	complete(new Response(body, { status, headers }));
}

function replySuccess(kind: Kind): void {
	if (kind === "blob") {
		reply(kind, 200, "private-file-bytes", "application/pdf");
	} else if (kind === "stream") {
		reply(kind, 200, "event: done\ndata: {}\n\n", "text/event-stream");
	} else {
		reply(kind, kind === "upload" ? 201 : 200, '{"id":"resource"}');
	}
}

beforeEach(() => {
	fetchMock.mockReset();
	pendingResponses.length = 0;
	FakeXHR.instances = [];

	fetchMock.mockImplementation(
		() =>
			new Promise<Response>(resolve => {
				pendingResponses.push(resolve);
			}),
	);

	vi.stubGlobal("fetch", fetchMock);
	vi.stubGlobal("XMLHttpRequest", FakeXHR);
	saveAccessToken("alice-token");
});

describe.each(kinds)("%s transport", kind => {
	it("uses the API prefix and captured bearer token", async () => {
		const controller = new AbortController();
		const pending = start(kind, path, { signal: controller.signal });

		if (kind === "upload") {
			expect(lastXHR().url).toBe(`/api/v1${path}`);
			expect(lastXHR().requestHeaders.get("Authorization"))
				.toBe("Bearer alice-token");
		} else {
			const [url, options] = fetchMock.mock.calls[0];

			expect(url).toBe(`/api/v1${path}`);
			expect(new Headers(options?.headers).get("Authorization"))
				.toBe("Bearer alice-token");
			expect(options?.signal).toBe(controller.signal);
			expect(options?.mode).toBe("same-origin");
			expect(options?.redirect).toBe("error");
			expect(options?.cache).toBe("no-store");
		}

		replySuccess(kind);
		const result = await pending;

		if (kind === "stream") {
			await (result as ApiStreamResponse).body.cancel();
		}
	});

	it.each([
		"https://outside.example/collect",
		"//outside.example/collect",
		"organizations",
		"/\\outside.example/collect",
		"/organizations#fragment",
		"/../outside-api",
		"/%2e%2e/outside-api",
	])("rejects unsafe path %s before sending", async target => {
		await expect(start(kind, target)).rejects.toMatchObject({
			code: "INVALID_API_PATH",
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(FakeXHR.instances).toHaveLength(0);
		expect(getAccessToken()).toBe("alice-token");
	});

	it.each([
		[
			"JSON",
			'{"code":"ACCESS_TOKEN_EXPIRED","message":"Session expired."}',
			"application/json",
		],
		["HTML", "<html>private diagnostics</html>", "text/html"],
		["empty", "", "application/json"],
		["malformed JSON", "{", "application/json"],
	])("invalidates its session on a %s 401", async (_name, body, type) => {
		const pending = start(kind);
		const assertion = expect(pending).rejects.toMatchObject({
			statusCode: 401,
		});

		reply(kind, 401, body, type);

		await assertion;
		expect(getAccessToken()).toBeNull();
	});

	it.each(["bob-token", "alice-token"])(
		"an old 401 preserves a newer login using %s",
		async token => {
			const pending = start(kind);
			const assertion = expect(pending).rejects.toMatchObject({
				statusCode: 401,
			});

			saveAccessToken(token);
			reply(kind, 401, "<html>Unauthorized</html>", "text/html");

			await assertion;
			expect(getAccessToken()).toBe(token);
		},
	);

	it("preserves auth:none behavior", async () => {
		const pending = start(kind, path, { auth: "none" });
		const assertion = expect(pending).rejects.toMatchObject({
			statusCode: 401,
		});

		const headers =
			kind === "upload"
				? lastXHR().requestHeaders
				: new Headers(fetchMock.mock.calls[0][1]?.headers);

		expect(headers.has("Authorization")).toBe(false);

		reply(kind, 401, '{"code":"INVALID_CREDENTIALS"}');

		await assertion;
		expect(getAccessToken()).toBe("alice-token");
	});

	it.each([400, 403, 404, 409, 422, 429, 500, 503])(
		"preserves the session and error contract on HTTP %i",
		async status => {
			const details = [{ field: "name", messages: ["Name is required."] }];
			const pending = start(kind);

			const assertion = expect(pending).rejects.toMatchObject({
				statusCode: status,
				code: "EXAMPLE_ERROR",
				message: "Request rejected.",
				details,
				requestId: "body-request",
				retryAfterSeconds: 7,
			});

			reply(
				kind,
				status,
				JSON.stringify({
					statusCode: 401,
					code: "EXAMPLE_ERROR",
					message: "Request rejected.",
					details,
					requestId: "body-request",
				}),
				"application/json",
				{
					"X-Request-Id": "header-request",
					"Retry-After": "7",
				},
			);

			await assertion;
			expect(getAccessToken()).toBe("alice-token");
		},
	);

	it("does not expose HTML errors and retains the header request ID", async () => {
		const pending = start(kind);

		const assertion = expect(pending).rejects.toMatchObject({
			statusCode: 502,
			code: "HTTP_ERROR",
			message: "The request failed. Please try again.",
			requestId: "gateway-request",
		});

		reply(
			kind,
			502,
			"<html>private stack trace</html>",
			"text/html",
			{ "X-Request-Id": "gateway-request" },
		);

		await assertion;
		expect(getAccessToken()).toBe("alice-token");
	});

	it("ignores malformed error details and unsafe messages", async () => {
		const pending = start(kind);

		const assertion = expect(pending).rejects.toMatchObject({
			statusCode: 400,
			message: "The request failed. Please try again.",
			details: undefined,
		});

		reply(
			kind,
			400,
			JSON.stringify({
				message: "<html>internal output</html>",
				details: [
					null,
					{ field: 1, messages: ["Invalid."] },
					{ field: "name", messages: [42] },
				],
			}),
		);

		await assertion;
	});

	it("reports a network failure without retrying or logging out", async () => {
		if (kind !== "upload") {
			fetchMock.mockRejectedValueOnce(new TypeError("Private network detail"));
		}

		const pending = start(kind);
		const assertion = expect(pending).rejects.toMatchObject({
			statusCode: undefined,
			code: "NETWORK_ERROR",
		});

		if (kind === "upload") {
			lastXHR().dispatchEvent(new Event("error"));
		}

		await assertion;
		expect(getAccessToken()).toBe("alice-token");

		if (kind === "upload") {
			expect(lastXHR().send).toHaveBeenCalledTimes(1);
		} else {
			expect(fetchMock).toHaveBeenCalledTimes(1);
		}
	});

	it("does not send when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort("A custom caller reason");

		await expect(
			start(kind, path, { signal: controller.signal }),
		).rejects.toMatchObject({ name: "AbortError" });

		expect(fetchMock).not.toHaveBeenCalled();
		expect(FakeXHR.instances).toHaveLength(0);
		expect(getAccessToken()).toBe("alice-token");
	});

	it("preserves explicit cancellation while awaiting a response", async () => {
		if (kind !== "upload") {
			fetchMock.mockImplementation(
				(_url, options) =>
					new Promise<Response>((_resolve, reject) => {
						options?.signal?.addEventListener(
							"abort",
							() => reject(new DOMException("Cancelled", "AbortError")),
							{ once: true },
						);
					}),
			);
		}

		const controller = new AbortController();
		const pending = start(kind, path, { signal: controller.signal });
		const assertion = expect(pending).rejects.toMatchObject({
			name: "AbortError",
		});

		controller.abort();

		await assertion;
		expect(getAccessToken()).toBe("alice-token");
	});
});

describe("JSON and session regression coverage", () => {
	it("sends the TSE-66 DELETE body and accepts only the empty 204", async () => {
		const response = new Response(null, { status: 204 });
		const read = vi.spyOn(response, "text");

		fetchMock.mockResolvedValueOnce(response);

		await expect(
			request<void>(
				"DELETE",
				"/organizations/org",
				{ confirmSlug: "acme" },
				{},
				true,
			),
		).resolves.toBeUndefined();

		const [url, options] = fetchMock.mock.calls[0];

		expect(url).toBe("/api/v1/organizations/org");
		expect(options?.method).toBe("DELETE");
		expect(options?.body).toBe('{"confirmSlug":"acme"}');
		expect(new Headers(options?.headers).get("Content-Type"))
			.toBe("application/json");
		expect(new Headers(options?.headers).get("Authorization"))
			.toBe("Bearer alice-token");
		expect(read).not.toHaveBeenCalled();
	});

	it("rejects a non-204 response for an empty DELETE contract", async () => {
		fetchMock.mockResolvedValueOnce(
			new Response('{"success":true}', {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		await expect(
			request<void>("DELETE", "/organizations/org", {}, {}, true),
		).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
	});

	it("compares session values and revision, not snapshot object identity", () => {
		const snapshot = getAuthSessionSnapshot();

		expect(getAuthSessionSnapshot()).not.toBe(snapshot);
		expect(isAuthSessionCurrent(snapshot)).toBe(true);

		saveAccessToken("alice-token");

		expect(isAuthSessionCurrent(snapshot)).toBe(false);

		invalidateAuthSession(snapshot);
		expect(getAccessToken()).toBe("alice-token");
	});

	it("supports an HTTP-date Retry-After value", async () => {
		vi.spyOn(Date, "now").mockReturnValue(
			Date.parse("2026-10-17T00:00:00Z"),
		);

		fetchMock.mockResolvedValueOnce(
			new Response("{}", {
				status: 429,
				headers: {
					"Content-Type": "application/json",
					"Retry-After": "Sat, 17 Oct 2026 00:00:30 GMT",
				},
			}),
		);

		await expect(apiGet("/organizations")).rejects.toMatchObject({
			retryAfterSeconds: 30,
		});
	});

	it.each(["-1", "invalid", "999999999999999999999999"])(
		"ignores invalid Retry-After %s",
		async value => {
			fetchMock.mockResolvedValueOnce(
				new Response("{}", {
					status: 429,
					headers: {
						"Content-Type": "application/json",
						"Retry-After": value,
					},
				}),
			);

			await expect(apiGet("/organizations")).rejects.toMatchObject({
				retryAfterSeconds: undefined,
			});
		},
	);

	it("distinguishes a failed JSON body transfer from invalid JSON", async () => {
		const response = new Response("{}", {
			headers: { "Content-Type": "application/json" },
		});

		vi.spyOn(response, "text").mockRejectedValueOnce(
			new TypeError("Connection lost"),
		);
		fetchMock.mockResolvedValueOnce(response);

		await expect(apiGet("/organizations")).rejects.toMatchObject({
			code: "NETWORK_ERROR",
		});

		expect(getAccessToken()).toBe("alice-token");
	});
});

describe("private Blob requests", () => {
	it("preserves the file bytes and media type", async () => {
		fetchMock.mockResolvedValueOnce(
			new Response("private PDF bytes", {
				headers: { "Content-Type": "application/pdf" },
			}),
		);

		const blob = await requestBlob(path);

		expect(blob.type).toBe("application/pdf");
		expect(await blob.text()).toBe("private PDF bytes");
	});

	it("handles a JSON error before attempting Blob conversion", async () => {
		const response = new Response(
			'{"code":"DOCUMENT_NOT_FOUND","message":"Document not found."}',
			{
				status: 404,
				headers: { "Content-Type": "application/json" },
			},
		);

		const readBlob = vi.spyOn(response, "blob");
		fetchMock.mockResolvedValueOnce(response);

		await expect(requestBlob(path)).rejects.toMatchObject({
			statusCode: 404,
			code: "DOCUMENT_NOT_FOUND",
		});

		expect(readBlob).not.toHaveBeenCalled();
	});

	it("rejects an HTML success and cancels its body", async () => {
		const response = new Response("<html>Login</html>", {
			headers: { "Content-Type": "text/html" },
		});

		const cancel = vi.spyOn(response.body!, "cancel");
		fetchMock.mockResolvedValueOnce(response);

		await expect(requestBlob(path)).rejects.toMatchObject({
			code: "INVALID_API_RESPONSE",
		});

		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it("preserves cancellation while reading file bytes", async () => {
		const controller = new AbortController();
		let writer!: ReadableStreamDefaultController<Uint8Array>;

		const source = new ReadableStream<Uint8Array>({
			start(value) {
				writer = value;
			},
		});

		controller.signal.addEventListener(
			"abort",
			() => writer.error(new DOMException("Cancelled", "AbortError")),
			{ once: true },
		);

		const response = new Response(source, {
			headers: { "Content-Type": "application/pdf" },
		});

		let markReading!: () => void;
		const reading = new Promise<void>(resolve => {
			markReading = resolve;
		});

		const nativeBlob = response.blob.bind(response);

		vi.spyOn(response, "blob").mockImplementation(() => {
			markReading();
			return nativeBlob();
		});

		fetchMock.mockResolvedValueOnce(response);

		const pending = requestBlob(path, { signal: controller.signal });
		const assertion = expect(pending).rejects.toMatchObject({
			name: "AbortError",
		});

		await reading;
		controller.abort();

		await assertion;
		expect(getAccessToken()).toBe("alice-token");
	});
});
