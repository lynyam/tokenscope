import { describe, it, expect, vi, beforeEach } from "vitest";
import { signIn, signUp, getCurrentUser, signOut } from "../../api/auth.api";
import * as httpClient from "../../api/http-client";
import { ApiError } from "../../api/api-error";

const TOKEN_KEY = "tokenscope_access_token";

describe("auth.api.ts — connected to the real backend contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("signIn calls apiRequest with the correct path, method, and skipAuth", async () => {
    const spy = vi.spyOn(httpClient, "apiRequest").mockResolvedValue({
      user: { id: "1", email: "a@b.com", displayName: "A" },
      accessToken: "token-123",
      tokenType: "Bearer",
      expiresIn: 3600,
    });

    await signIn({ email: "a@b.com", password: "x" });

    const actualCall = spy.mock.calls[0];
    const expectedCall = [
      "/auth/signin",
      { method: "POST", body: { email: "a@b.com", password: "x" }, skipAuth: true },
    ];

    console.log("expected apiRequest call:", JSON.stringify(expectedCall));
    console.log("actual apiRequest call:  ", JSON.stringify(actualCall));

    expect(actualCall).toEqual(expectedCall);
  });

  it("signIn stores only the access token, nothing else", async () => {
    vi.spyOn(httpClient, "apiRequest").mockResolvedValue({
      user: { id: "1", email: "a@b.com", displayName: "A" },
      accessToken: "token-123",
      tokenType: "Bearer",
      expiresIn: 3600,
    });

    await signIn({ email: "a@b.com", password: "super-secret" });

    const actualStoredKeys = Object.keys(localStorage);
    const actualToken = localStorage.getItem(TOKEN_KEY);
    const expectedKeys = [TOKEN_KEY];
    const expectedToken = "token-123";

    console.log("expected localStorage keys:", expectedKeys);
    console.log("actual localStorage keys:  ", actualStoredKeys);
    console.log("expected token value:", expectedToken);
    console.log("actual token value:  ", actualToken);

    expect(actualStoredKeys).toEqual(expectedKeys);
    expect(actualToken).toBe(expectedToken);
  });

  it("signIn returns exactly the backend's user object, unmodified", async () => {
    const backendUser = { id: "1", email: "a@b.com", displayName: "A" };
    vi.spyOn(httpClient, "apiRequest").mockResolvedValue({
      user: backendUser,
      accessToken: "token-123",
      tokenType: "Bearer",
      expiresIn: 3600,
    });

    const actual = await signIn({ email: "a@b.com", password: "x" });
    const expected = backendUser;

    console.log("expected returned user:", expected);
    console.log("actual returned user:  ", actual);

    expect(actual).toEqual(expected);
  });

  it("signUp calls apiRequest with skipAuth: true", async () => {
    const spy = vi.spyOn(httpClient, "apiRequest").mockResolvedValue({
      user: { id: "1", email: "a@b.com", displayName: "A" },
      accessToken: "token-123",
      tokenType: "Bearer",
      expiresIn: 3600,
    });

    await signUp({ email: "a@b.com", password: "x", displayName: "A" });

    const actualPath = spy.mock.calls[0][0];
    const actualOptions = spy.mock.calls[0][1];
    const expectedPath = "/auth/signup";
    const expectedSkipAuth = true;

    console.log("expected path:", expectedPath, "| expected skipAuth:", expectedSkipAuth);
    console.log("actual path:  ", actualPath, "| actual skipAuth:  ", actualOptions?.skipAuth);

    expect(actualPath).toBe(expectedPath);
    expect(actualOptions?.skipAuth).toBe(expectedSkipAuth);
  });

  it("getCurrentUser returns null immediately when no token is stored, WITHOUT calling apiRequest", async () => {
    const spy = vi.spyOn(httpClient, "apiRequest");

    const actualResult = await getCurrentUser();
    const actualCallCount = spy.mock.calls.length;
    const expectedResult = null;
    const expectedCallCount = 0;

    console.log("expected result:", expectedResult, "| expected apiRequest calls:", expectedCallCount);
    console.log("actual result:  ", actualResult, "| actual apiRequest calls:  ", actualCallCount);

    expect(actualResult).toBe(expectedResult);
    expect(actualCallCount).toBe(expectedCallCount);
  });

  it("getCurrentUser calls GET /auth/me when a token IS stored", async () => {
    localStorage.setItem(TOKEN_KEY, "existing-token");
    const spy = vi.spyOn(httpClient, "apiRequest").mockResolvedValue({
      id: "1",
      email: "a@b.com",
      displayName: "A",
    });

    await getCurrentUser();

    const actualCall = spy.mock.calls[0];
    const expectedCall = ["/auth/me"];

    console.log("expected apiRequest call:", expectedCall);
    console.log("actual apiRequest call:  ", actualCall);

    expect(actualCall).toEqual(expectedCall);
  });

  it("getCurrentUser clears the stored token and returns null when /auth/me rejects", async () => {
    localStorage.setItem(TOKEN_KEY, "expired-token");
    vi.spyOn(httpClient, "apiRequest").mockRejectedValue(
      new ApiError({
        statusCode: 401,
        code: "ACCESS_TOKEN_EXPIRED",
        error: "Unauthorized",
        message: "Your session has expired.",
        requestId: "req_1",
      }),
    );

    const actualResult = await getCurrentUser();
    const actualToken = localStorage.getItem(TOKEN_KEY);
    const expectedResult = null;
    const expectedToken = null;

    console.log("expected result:", expectedResult, "| expected stored token:", expectedToken);
    console.log("actual result:  ", actualResult, "| actual stored token:  ", actualToken);

    expect(actualResult).toBe(expectedResult);
    expect(actualToken).toBe(expectedToken);
  });

  it("signOut clears the stored token and makes no network request", async () => {
    localStorage.setItem(TOKEN_KEY, "some-token");
    const spy = vi.spyOn(httpClient, "apiRequest");

    await signOut();

    const actualToken = localStorage.getItem(TOKEN_KEY);
    const actualCallCount = spy.mock.calls.length;
    const expectedToken = null;
    const expectedCallCount = 0;

    console.log("expected stored token:", expectedToken, "| expected apiRequest calls:", expectedCallCount);
    console.log("actual stored token:  ", actualToken, "| actual apiRequest calls:  ", actualCallCount);

    expect(actualToken).toBe(expectedToken);
    expect(actualCallCount).toBe(expectedCallCount);
  });

  it("auth.api.ts contains no references to mock infrastructure", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync("src/api/auth.api.ts", "utf-8");
    const forbiddenPatterns = /MockApiError|mockUsers|mockAccounts|mock-session/;

    const actualMatch = source.match(forbiddenPatterns);

    console.log("expected match: null (no mock references)");
    console.log("actual match:  ", actualMatch);

    expect(actualMatch).toBeNull();
  });
});