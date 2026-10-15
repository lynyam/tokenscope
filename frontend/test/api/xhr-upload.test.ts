import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, uploadMultipart } from "@/api/http-client";
import { getAccessToken, saveAccessToken } from "@/api/auth-session";
import { FakeXhr } from "./fake-xhr";

const form = () => {
  const data = new FormData();
  data.append("file", new File(["hello"], "notes.txt", { type: "text/plain" }));
  return data;
};
const created = { id: "doc-1", originalName: "notes.txt" };

beforeEach(() => {
  FakeXhr.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  saveAccessToken("alice-token");
});
afterEach(() => { FakeXhr.instances = []; });

describe("uploadMultipart", () => {
  it("posts the FormData to the same-origin API with bearer auth and no JSON content type", async () => {
    const body = form();
    const upload = uploadMultipart("/organizations/o/projects/p/documents", body);
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/api/v1/organizations/o/projects/p/documents");
    expect(xhr.body).toBe(body);
    expect(xhr.requestHeaders.authorization).toBe("Bearer alice-token");
    expect(xhr.requestHeaders.accept).toBe("application/json");
    // The browser must add multipart/form-data together with its boundary.
    expect(xhr.requestHeaders["content-type"]).toBeUndefined();
    xhr.respond(201, JSON.stringify(created));
    await expect(upload).resolves.toEqual(created);
  });

  it("omits the bearer for auth: none", async () => {
    const upload = uploadMultipart("/x", form(), { auth: "none" });
    expect(FakeXhr.last.requestHeaders.authorization).toBeUndefined();
    FakeXhr.last.respond(201, "{}");
    await upload;
  });

  it("reports measured and indeterminate progress without resolving", async () => {
    const onProgress = vi.fn();
    const upload = uploadMultipart("/x", form(), { onProgress });
    const settled = vi.fn();
    upload.then(settled, settled);
    const xhr = FakeXhr.last;
    xhr.progress(10, 100);
    xhr.progress(40);
    xhr.progress(100, 100);
    await Promise.resolve();
    expect(onProgress.mock.calls.map(call => call[0])).toEqual([
      { loaded: 10, total: 100 },
      { loaded: 40 },
      { loaded: 100, total: 100 },
    ]);
    expect(onProgress.mock.calls[1][0]).not.toHaveProperty("total");
    // 100% uploaded is not "saved": only the HTTP response completes the upload.
    expect(settled).not.toHaveBeenCalled();
    xhr.respond(201, JSON.stringify(created));
    await expect(upload).resolves.toEqual(created);
  });

  it("is not affected by a progress observer that throws", async () => {
    const upload = uploadMultipart("/x", form(), { onProgress: () => { throw new Error("observer bug"); } });
    FakeXhr.last.progress(1, 2);
    FakeXhr.last.respond(201, JSON.stringify(created));
    await expect(upload).resolves.toEqual(created);
  });

  it("does not send when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(uploadMultipart("/x", form(), { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it("aborts the XHR during transfer and stays distinguishable from a network failure", async () => {
    const controller = new AbortController();
    const onProgress = vi.fn();
    const upload = uploadMultipart("/x", form(), { signal: controller.signal, onProgress });
    const xhr = FakeXhr.last;
    xhr.progress(5, 10);
    controller.abort();
    const error = (await upload.catch((e: unknown) => e)) as Error;
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error.name).toBe("AbortError");
    expect(xhr.aborted).toBe(true);
    xhr.progress(9, 10); // Late events must be ignored.
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe("alice-token");
  });

  it("reports a network failure as NETWORK_ERROR without logging out", async () => {
    const upload = uploadMultipart("/x", form());
    FakeXhr.last.networkFailure();
    await expect(upload).rejects.toMatchObject({ statusCode: undefined, code: "NETWORK_ERROR" });
    expect(getAccessToken()).toBe("alice-token");
  });

  it("settles once and removes every listener on each exit path", async () => {
    const paths: Array<(xhr: FakeXhr, controller: AbortController) => void> = [
      xhr => xhr.respond(201, JSON.stringify(created)),
      xhr => xhr.respond(413, JSON.stringify({ code: "PAYLOAD_TOO_LARGE", message: "Too large." })),
      xhr => xhr.networkFailure(),
      (_xhr, controller) => controller.abort(),
    ];
    for (const finish of paths) {
      const controller = new AbortController();
      const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
      const upload = uploadMultipart("/x", form(), { signal: controller.signal });
      const xhr = FakeXhr.last;
      finish(xhr, controller);
      await upload.catch(() => undefined);
      expect(xhr.hasListeners()).toBe(false);
      expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
      // A second terminal event cannot produce a second outcome or throw.
      expect(() => { xhr.onload?.(); xhr.onerror?.(); }).not.toThrow();
    }
  });

  it("keeps structured HTTP errors, details and request IDs", async () => {
    const details = [{ field: "file", messages: ["file is required"] }];
    const upload = uploadMultipart("/x", form());
    FakeXhr.last.respond(400, JSON.stringify({ code: "VALIDATION_ERROR", message: "Bad file.", details, requestId: "r-1" }));
    await expect(upload).rejects.toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR", details, requestId: "r-1" });
  });

  it.each([
    ["<html>Bad Gateway</html>", 502],
    ["", 500],
    ["{broken", 429],
  ])("never exposes a malformed error body (%s, HTTP %i)", async (body, status) => {
    const upload = uploadMultipart("/x", form());
    FakeXhr.last.respond(status, body, { "Content-Type": "text/html", "X-Request-Id": "gw-1" });
    const error = (await upload.catch((e: unknown) => e)) as Error;
    expect(error).toMatchObject({ statusCode: status, code: "HTTP_ERROR", requestId: "gw-1" });
    expect(error.message).toBe("The request failed. Please try again.");
    expect(getAccessToken()).toBe("alice-token");
  });

  it.each([403, 404, 409, 422, 429, 503])("HTTP %i preserves the session", async status => {
    const upload = uploadMultipart("/x", form());
    FakeXhr.last.respond(status, JSON.stringify({ code: "E" }));
    await expect(upload).rejects.toMatchObject({ statusCode: status });
    expect(getAccessToken()).toBe("alice-token");
  });

  it.each(["not-json", "[1]x", "null"])("rejects a 2xx response that is not the expected JSON (%s)", async body => {
    const upload = uploadMultipart("/x", form());
    FakeXhr.last.respond(201, body);
    await expect(upload).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
  });

  it("rejects a 2xx HTML response (login page behind a proxy)", async () => {
    const upload = uploadMultipart("/x", form());
    FakeXhr.last.respond(200, "{}", { "Content-Type": "text/html" });
    await expect(upload).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
  });

  it.each(["https://evil.test/x", "//evil.test/x", "documents", "/\\evil.test", "/a b"])(
    "never sends credentials to %s", async path => {
      await expect(uploadMultipart(path, form())).rejects.toBeInstanceOf(TypeError);
      expect(FakeXhr.instances).toHaveLength(0);
    });

  it("requires a FormData body", async () => {
    await expect(uploadMultipart("/x", {} as FormData)).rejects.toBeInstanceOf(TypeError);
    expect(FakeXhr.instances).toHaveLength(0);
  });
});
