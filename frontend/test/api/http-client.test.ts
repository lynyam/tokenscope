import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/api/http-client";
import { clearAuthSession, getAccessToken, saveAccessToken, subscribeToAuthInvalidation } from "@/api/auth-session";

const fetchMock = vi.fn<typeof fetch>();
const unsubscribe: Array<() => void> = [];
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  saveAccessToken("alice-token");
});
afterEach(() => { unsubscribe.splice(0).forEach(stop => stop()); });

describe("shared M1 HTTP client", () => {
  it("uses /api/v1 and the latest bearer token for each request", async () => {
    fetchMock.mockImplementation(async () => json([]));
    await apiGet("/organizations");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/organizations");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer alice-token");
    saveAccessToken("bob-token");
    await apiGet("/organizations");
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("Authorization")).toBe("Bearer bob-token");
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).has("Content-Type")).toBe(false);
  });

  it("serializes JSON, including null used to clear a field", async () => {
    fetchMock.mockResolvedValue(json({ description: null }));
    await apiPatch("/organizations/org/projects/project", { description: null });
    const options = fetchMock.mock.calls[0][1]!;
    expect(options.method).toBe("PATCH");
    expect(options.body).toBe('{"description":null}');
    expect(new Headers(options.headers).get("Content-Type")).toBe("application/json");
  });

  it("public sign-in omits the old bearer and preserves the session on wrong credentials", async () => {
    fetchMock.mockResolvedValue(json({ code: "INVALID_CREDENTIALS", message: "Invalid email or password." }, 401));
    await expect(apiPost("/auth/signin", { email: "alice@example.test", password: "wrong" }, { auth: "none" }))
      .rejects.toMatchObject({ statusCode: 401, code: "INVALID_CREDENTIALS" });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has("Authorization")).toBe(false);
    expect(getAccessToken()).toBe("alice-token");
  });

  it("clears the token and notifies auth once for concurrent protected 401s", async () => {
    const invalidated = vi.fn();
    unsubscribe.push(subscribeToAuthInvalidation(invalidated));
    fetchMock.mockImplementation(async () => json({ code: "ACCESS_TOKEN_EXPIRED" }, 401));
    const results = await Promise.allSettled([apiGet("/auth/me"), apiGet("/organizations")]);
    expect(results.every(result => result.status === "rejected")).toBe(true);
    expect(getAccessToken()).toBeNull();
    expect(invalidated).toHaveBeenCalledTimes(1);
  });

  it("also invalidates on a non-JSON 401", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Unauthorized</html>", { status: 401 }));
    await expect(apiGet("/auth/me")).rejects.toMatchObject({ statusCode: 401, code: "HTTP_ERROR" });
    expect(getAccessToken()).toBeNull();
  });

  it.each(["bob-token", "alice-token"])("does not clear a newer login even if its token is %s", async token => {
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = apiGet("/organizations");
    saveAccessToken(token);
    finish(json({ code: "ACCESS_TOKEN_EXPIRED" }, 401));
    await expect(pending).rejects.toBeInstanceOf(ApiError);
    expect(getAccessToken()).toBe(token);
  });

  it.each([400, 403, 404, 409, 500])("keeps authentication on HTTP %i and retains structured errors", async status => {
    const details = [{ field: "email", messages: ["email must be an email"] }];
    fetchMock.mockResolvedValue(json({
      statusCode: 401, // An untrusted body must not override the actual HTTP status.
      code: "EXAMPLE_ERROR", message: "Request rejected.", details, requestId: "request-1",
    }, status));
    await expect(apiGet("/organizations")).rejects.toMatchObject({
      statusCode: status, code: "EXAMPLE_ERROR", message: "Request rejected.", details, requestId: "request-1",
    });
    expect(getAccessToken()).toBe("alice-token");
  });

  it("handles a gateway error safely and preserves the request ID header", async () => {
    fetchMock.mockResolvedValue(new Response("<html>private proxy diagnostic</html>", {
      status: 502, headers: { "X-Request-Id": "gateway-1" },
    }));
    await expect(apiGet("/organizations")).rejects.toMatchObject({
      statusCode: 502, code: "HTTP_ERROR", requestId: "gateway-1",
      message: "The request failed. Please try again.",
    });
  });

  it("ignores malformed field-error entries", async () => {
    fetchMock.mockResolvedValue(json({ details: [{ field: 1, messages: ["bad"] }, null] }, 400));
    await expect(apiPost("/organizations", {})).rejects.toMatchObject({ details: undefined });
  });

  it("accepts 204 from DELETE without attempting JSON parsing", async () => {
    const response = new Response(null, { status: 204 });
    const parse = vi.spyOn(response, "json");
    fetchMock.mockResolvedValue(response);
    await expect(apiDelete("/organizations/org/members/user")).resolves.toBeUndefined();
    expect(parse).not.toHaveBeenCalled();
  });

  it.each(["<html>SPA fallback</html>", "", "null"])("rejects invalid JSON resource responses: %s", async body => {
    fetchMock.mockResolvedValue(new Response(body));
    await expect(apiGet("/organizations")).rejects.toMatchObject({ code: "INVALID_API_RESPONSE", statusCode: 200 });
  });

  it("rejects an unexpected empty response for a resource request", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiGet("/auth/me")).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
  });

  it("requires the documented 204 for M1 DELETE", async () => {
    fetchMock.mockResolvedValue(json({ success: true }));
    await expect(apiDelete("/organizations/org/members/user")).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
  });

  it("reports a connection failure without logging out or retrying a mutation", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(apiPost("/organizations", { name: "Acme" }))
      .rejects.toMatchObject({ statusCode: undefined, code: "NETWORK_ERROR" });
    expect(getAccessToken()).toBe("alice-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes cancellation to fetch and preserves AbortError", async () => {
    const controller = new AbortController();
    const aborted = new DOMException("Aborted", "AbortError");
    fetchMock.mockRejectedValue(aborted);
    await expect(apiGet("/organizations", { signal: controller.signal })).rejects.toBe(aborted);
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
    expect(getAccessToken()).toBe("alice-token");
  });

  it("clears only the token on sign-out and releases subscribers", () => {
    localStorage.setItem("theme", "dark");
    const listener = vi.fn();
    const stop = subscribeToAuthInvalidation(listener);
    stop();
    clearAuthSession();
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(listener).not.toHaveBeenCalled();
  });
});
