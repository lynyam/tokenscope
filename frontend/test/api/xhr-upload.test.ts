import { beforeEach, describe, expect, it, vi } from "vitest";

import { uploadMultipart } from "@/api/http-client";
import { getAccessToken, saveAccessToken } from "@/api/auth-session";

import { FakeXHR, lastXHR } from "./helpers/fake-xhr";

const path = "/organizations/org/projects/project/documents";

beforeEach(() => {
	FakeXHR.instances = [];
	vi.stubGlobal("XMLHttpRequest", FakeXHR);
	saveAccessToken("alice-token");
});

describe("multipart upload lifecycle", () => {
	it("sends FormData unchanged and lets the browser set Content-Type", async () => {
		const form = new FormData();
		form.append("file", new File(["hello"], "brief.txt", { type: "text/plain" }));

		const pending = uploadMultipart(path, form);
		const xhr = lastXHR();

		expect(xhr.method).toBe("POST");
		expect(xhr.body).toBe(form);
		expect(xhr.requestHeaders.get("Authorization")).toBe("Bearer alice-token");
		expect(xhr.requestHeaders.get("Accept")).toBe("application/json");
		expect(xhr.requestHeaders.has("Content-Type")).toBe(false);

		xhr.respond(201, '{"id":"document"}');

		await expect(pending).resolves.toEqual({ id: "document" });
	});

	it("reports measured progress but waits for the HTTP response at 100%", async () => {
		const onProgress = vi.fn();
		const completed = vi.fn();

		const pending = uploadMultipart(path, new FormData(), { onProgress });
		const observed = pending.then(completed);
		const xhr = lastXHR();

		xhr.progress(3);
		xhr.progress(5, 10);
		xhr.progress(10, 10);

		expect(onProgress).toHaveBeenNthCalledWith(1, { loaded: 3 });
		expect(onProgress).toHaveBeenNthCalledWith(2, { loaded: 5, total: 10 });
		expect(onProgress).toHaveBeenNthCalledWith(3, { loaded: 10, total: 10 });

		// Allow pending promise callbacks to run if progress incorrectly resolved it.
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		expect(completed).not.toHaveBeenCalled();

		xhr.respond(201, '{"id":"saved-document"}');

		await observed;
		expect(completed).toHaveBeenCalledWith({ id: "saved-document" });
	});

	it.each(["success", "network", "abort", "timeout"] as const)(
		"cleans up listeners after %s",
		async outcome => {
			const controller = new AbortController();
			const onProgress = vi.fn();

			const removeSignalListener = vi.spyOn(
				controller.signal,
				"removeEventListener",
			);

			const pending = uploadMultipart(path, new FormData(), {
				signal: controller.signal,
				onProgress,
			});

			// Attach both handlers before triggering the controlled outcome.
			const observed = pending.then(
				value => ({ value }),
				error => ({ error }),
			);

			const xhr = lastXHR();
			const removeRequestListener = vi.spyOn(xhr, "removeEventListener");
			const removeProgressListener = vi.spyOn(xhr.upload, "removeEventListener");

			if (outcome === "success") {
				xhr.respond(201, '{"id":"document"}');
			} else if (outcome === "network") {
				xhr.dispatchEvent(new Event("error"));
			} else if (outcome === "abort") {
				controller.abort();
			} else {
				xhr.dispatchEvent(new Event("timeout"));
			}

			const result = await observed;

			if (outcome === "success") {
				expect(result).toEqual({ value: { id: "document" } });
			} else if (outcome === "abort") {
				expect(result).toMatchObject({ error: { name: "AbortError" } });
			} else {
				expect(result).toMatchObject({
					error: {
						code: outcome === "network" ? "NETWORK_ERROR" : "REQUEST_TIMEOUT",
					},
				});
			}

			for (const event of ["load", "error", "abort", "timeout"]) {
				expect(removeRequestListener)
					.toHaveBeenCalledWith(event, expect.any(Function));
			}

			expect(removeProgressListener)
				.toHaveBeenCalledWith("progress", expect.any(Function));
			expect(removeSignalListener)
				.toHaveBeenCalledWith("abort", expect.any(Function));

			const abortCalls = xhr.abort.mock.calls.length;

			// No listener should react after settlement.
			controller.abort();
			xhr.progress(100, 100);
			xhr.dispatchEvent(new Event("error"));

			expect(xhr.abort).toHaveBeenCalledTimes(abortCalls);
			expect(onProgress).not.toHaveBeenCalled();
			expect(getAccessToken()).toBe("alice-token");
		},
	);

	it("rejects malformed success JSON", async () => {
		const pending = uploadMultipart(path, new FormData());
		const assertion = expect(pending).rejects.toMatchObject({
			code: "INVALID_API_RESPONSE",
			statusCode: 201,
		});

		lastXHR().respond(201, "{");

		await assertion;
	});

	it("rejects an unexpected final URL", async () => {
		const pending = uploadMultipart(path, new FormData());
		const assertion = expect(pending).rejects.toMatchObject({
			code: "INVALID_API_RESPONSE",
		});

		lastXHR().respond(
			200,
			'{"id":"unexpected"}',
			{ "Content-Type": "application/json" },
			new URL("/login", window.location.origin).href,
		);

		await assertion;
		expect(getAccessToken()).toBe("alice-token");
	});

	it("rejects and aborts if a synchronous progress callback throws", async () => {
		const failure = new Error("Progress rendering failed");

		const pending = uploadMultipart(path, new FormData(), {
			onProgress: () => {
				throw failure;
			},
		});

		const assertion = expect(pending).rejects.toBe(failure);
		const xhr = lastXHR();

		xhr.progress(1, 2);

		await assertion;
		expect(xhr.abort).toHaveBeenCalledTimes(1);

		// A late HTTP response must not change the rejected result.
		xhr.respond(201, '{"id":"late"}');
	});
});
