import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestStream } from "@/api/http-client";
import { getAccessToken, saveAccessToken } from "@/api/auth-session";

const fetchMock = vi.fn<typeof fetch>();
const sse = (body: BodyInit | null, type = "text/event-stream; charset=utf-8", status = 200) =>
  new Response(body, { status, headers: { "Content-Type": type } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  saveAccessToken("alice-token");
});

describe("requestStream", () => {
  it("sends an authenticated same-origin JSON POST that accepts an event stream", async () => {
    fetchMock.mockResolvedValue(sse("data: {}\n\n"));
    await requestStream("/organizations/o/projects/p/assistant", { question: "Why?" });
    const [url, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(url).toBe("/api/v1/organizations/o/projects/p/assistant");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"question":"Why?"}');
    expect(headers.get("Accept")).toBe("text/event-stream");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer alice-token");
  });

  it("returns the response without reading the body, so an early chunk reaches the caller before completion", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    fetchMock.mockResolvedValue(sse(body));
    const { response } = await requestStream("/x", {});
    expect(response.bodyUsed).toBe(false);
    const reader = response.body!.getReader();
    controller.enqueue(new TextEncoder().encode("data: first\n\n"));
    const first = await reader.read(); // The stream is still open.
    expect(new TextDecoder().decode(first.value)).toBe("data: first\n\n");
    controller.close();
    expect((await reader.read()).done).toBe(true);
  });

  it("cancellation after the helper returns stops consumption", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull() {}, cancel: cancelled });
    fetchMock.mockResolvedValue(sse(body));
    const { response } = await requestStream("/x", {});
    await response.body!.cancel();
    expect(cancelled).toHaveBeenCalled();
  });

  it("forwards the abort signal to fetch and keeps AbortError distinct", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const pending = requestStream("/x", {}, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(getAccessToken()).toBe("alice-token");
  });

  it("accepts content-type parameters and any letter case", async () => {
    fetchMock.mockResolvedValue(sse("x", "Text/Event-Stream;charset=utf-8"));
    await expect(requestStream("/x", {})).resolves.toBeDefined();
  });

  it("retains the opening session: invalidateSession signs out only that session", async () => {
    fetchMock.mockResolvedValue(sse("x"));
    const stream = await requestStream("/x", {});
    stream.invalidateSession();
    expect(getAccessToken()).toBeNull();
  });

  it("an old stream cannot sign out a newer login, even for the same token", async () => {
    fetchMock.mockResolvedValue(sse("x"));
    const stream = await requestStream("/x", {});
    saveAccessToken("alice-token"); // Session B for the same user and same token value.
    stream.invalidateSession();
    expect(getAccessToken()).toBe("alice-token");
  });

  it("does not expose the raw token", async () => {
    fetchMock.mockResolvedValue(sse("x"));
    const stream = await requestStream("/x", {});
    expect(JSON.stringify(Object.keys(stream))).not.toContain("token");
    expect(JSON.stringify(stream)).not.toContain("alice-token");
  });

  it("invalidateSession is a no-op without authentication", async () => {
    fetchMock.mockResolvedValue(sse("x"));
    const stream = await requestStream("/x", {}, { auth: "none" });
    stream.invalidateSession();
    expect(getAccessToken()).toBe("alice-token");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has("Authorization")).toBe(false);
  });

  it("maps an initial JSON failure to ApiError", async () => {
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ code: "LLM_PROVIDER_BUSY", message: "Try again later.", requestId: "r-9" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    ));
    await expect(requestStream("/x", {})).rejects.toMatchObject({ statusCode: 503, code: "LLM_PROVIDER_BUSY", requestId: "r-9" });
    expect(getAccessToken()).toBe("alice-token"); // Provider failures never end the app session.
  });

  it("maps initial non-JSON failures safely", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 }));
    const error = (await requestStream("/x", {}).catch((e: unknown) => e)) as Error;
    expect(error).toMatchObject({ statusCode: 502, code: "HTTP_ERROR" });
    expect(error.message).not.toContain("html");
  });

  it("a non-JSON 401 invalidates the captured session", async () => {
    fetchMock.mockResolvedValue(new Response("<html>nope</html>", { status: 401 }));
    await expect(requestStream("/x", {})).rejects.toMatchObject({ statusCode: 401 });
    expect(getAccessToken()).toBeNull();
  });

  it("a late 401 from an old session cannot sign out a newer login", async () => {
    let finish!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = requestStream("/x", {});
    saveAccessToken("bob-token");
    finish(new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } }));
    await expect(pending).rejects.toMatchObject({ statusCode: 401 });
    expect(getAccessToken()).toBe("bob-token");
  });

  it("rejects a wrong content type and releases the body", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull() {}, cancel: cancelled });
    fetchMock.mockResolvedValue(sse(body, "text/html"));
    await expect(requestStream("/x", {})).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
    expect(cancelled).toHaveBeenCalled();
  });

  it("rejects a successful response without a body", async () => {
    fetchMock.mockResolvedValue(sse(null, "text/event-stream", 200));
    await expect(requestStream("/x", {})).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
  });

  it("reports connection failures as NETWORK_ERROR and never retries", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(requestStream("/x", {})).rejects.toMatchObject({ statusCode: undefined, code: "NETWORK_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe("alice-token");
  });

  it.each(["https://evil.test/x", "//evil.test/x", "assistant"])("never sends credentials to %s", async path => {
    await expect(requestStream(path, {})).rejects.toBeInstanceOf(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not follow redirects with credentials", async () => {
    fetchMock.mockResolvedValue(Object.defineProperty(new Response(null), "type", { value: "opaqueredirect" }));
    await expect(requestStream("/x", {})).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe("manual");
  });
});
