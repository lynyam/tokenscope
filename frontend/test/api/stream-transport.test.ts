import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiPostStream } from "@/api/http-client";
import { getAccessToken, saveAccessToken } from "@/api/auth-session";

const fetchMock = vi.fn<typeof fetch>();
const path = "/organizations/org/projects/project/assistant";

const requestBody = {
	question: "Which model contributes most to the estimated cost?",
	from: "2026-10-01T00:00:00.000Z",
	to: "2026-10-02T00:00:00.000Z",
	filters: {},
};

function sseResponse(
	body: BodyInit | null = "event: done\ndata: {}\n\n",
): Response {
	return new Response(body, {
		status: 200,
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"X-Request-Id": "stream-request",
		},
	});
}

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
	saveAccessToken("alice-token");
});

describe("authenticated streamed POST", () => {
	it("sends JSON and returns the original unread stream", async () => {
		const response = sseResponse();
		const readText = vi.spyOn(response, "text");
		const readJson = vi.spyOn(response, "json");

		fetchMock.mockResolvedValueOnce(response);

		const stream = await apiPostStream(path, requestBody);
		const [url, options] = fetchMock.mock.calls[0];
		const headers = new Headers(options?.headers);

		expect(url).toBe(`/api/v1${path}`);
		expect(options?.method).toBe("POST");
		expect(options?.body).toBe(JSON.stringify(requestBody));
		expect(headers.get("Accept")).toBe("text/event-stream");
		expect(headers.get("Content-Type")).toBe("application/json");
		expect(headers.get("Authorization")).toBe("Bearer alice-token");

		expect(stream.body).toBe(response.body);
		expect(stream.requestId).toBe("stream-request");
		expect(response.bodyUsed).toBe(false);
		expect(stream.body.locked).toBe(false);
		expect(readText).not.toHaveBeenCalled();
		expect(readJson).not.toHaveBeenCalled();

		await stream.body.cancel();
	});

	it.each([
		[200, "application/json"],
		[200, "text/html"],
		[201, "text/event-stream"],
	])(
		"rejects HTTP %i with content type %s and cancels its body",
		async (status, contentType) => {
			const response = new Response("unexpected", {
				status,
				headers: { "Content-Type": contentType },
			});

			const cancel = vi.spyOn(response.body!, "cancel");
			fetchMock.mockResolvedValueOnce(response);

			await expect(apiPostStream(path, requestBody)).rejects.toMatchObject({
				statusCode: status,
				code: "INVALID_API_RESPONSE",
			});

			expect(cancel).toHaveBeenCalledTimes(1);
			expect(getAccessToken()).toBe("alice-token");
		},
	);

	it("rejects a response without a readable body", async () => {
		fetchMock.mockResolvedValueOnce(sseResponse(null));

		await expect(apiPostStream(path, requestBody)).rejects.toMatchObject({
			code: "INVALID_API_RESPONSE",
		});
	});

	it("delivers an early chunk and preserves cancellation after returning", async () => {
		const controller = new AbortController();
		let writer!: ReadableStreamDefaultController<Uint8Array>;

		const source = new ReadableStream<Uint8Array>({
			start(value) {
				writer = value;
			},
		});

		// The controlled network imitates fetch's abort propagation.
		// This tests signal forwarding and the returned stream's lifecycle.
		fetchMock.mockImplementation(async (_url, options) => {
			options?.signal?.addEventListener(
				"abort",
				() => writer.error(new DOMException("Cancelled", "AbortError")),
				{ once: true },
			);

			return sseResponse(source);
		});

		const stream = await apiPostStream(path, requestBody, {
			signal: controller.signal,
		});

		const reader = stream.body.getReader();
		const chunk = new TextEncoder().encode(
			'event: delta\ndata: {"text":"First words"}\n\n',
		);

		// The source is still open: receiving this proves no full-body buffering.
		writer.enqueue(chunk);

		const first = await reader.read();
		expect(first.done).toBe(false);
		expect(first.value).toEqual(chunk);

		const next = reader.read();
		const assertion = expect(next).rejects.toMatchObject({
			name: "AbortError",
		});

		controller.abort();

		await assertion;
		reader.releaseLock();

		expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
		expect(getAccessToken()).toBe("alice-token");
	});

	it("recognizes its current session and can invalidate that session", async () => {
		fetchMock.mockResolvedValueOnce(sseResponse());

		const stream = await apiPostStream(path, requestBody);

		expect(stream.isSessionCurrent()).toBe(true);

		stream.invalidateSession();

		expect(getAccessToken()).toBeNull();
		expect(stream.isSessionCurrent()).toBe(false);

		await stream.body.cancel();
	});

	it.each(["alice-token", "bob-token"])(
		"retains the original session identity after a new login using %s",
		async token => {
			fetchMock.mockResolvedValueOnce(sseResponse());

			const stream = await apiPostStream(path, requestBody);
			saveAccessToken(token);

			expect(stream.isSessionCurrent()).toBe(false);

			stream.invalidateSession();

			expect(getAccessToken()).toBe(token);
			await stream.body.cancel();
		},
	);

	it("leaves provider error events to the assistant parser", async () => {
		fetchMock.mockResolvedValueOnce(
			sseResponse(
				'event: error\ndata: {"code":"LLM_PROVIDER_BUSY","message":"Try later.","retryable":true}\n\n',
			),
		);

		const stream = await apiPostStream(path, requestBody);

		expect(getAccessToken()).toBe("alice-token");
		expect(stream.isSessionCurrent()).toBe(true);

		await stream.body.cancel();
	});
});
