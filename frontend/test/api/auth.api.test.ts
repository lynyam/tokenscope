import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCurrentUser,
  signIn,
  signUp,
} from "@/api/auth.api";
import {
  getAccessToken,
  saveAccessToken,
} from "@/api/auth-session";
import type { AuthResponse } from "@/types/workspace.types";

const fetchMock = vi.fn<typeof fetch>();

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "alice@example.test",
  displayName: "Alice",
};

const response: AuthResponse = {
  user,
  accessToken: "new-test-token",
  tokenType: "Bearer",
  expiresIn: 3600,
};

// Spaces deliberately prove that the adapter preserves the password.
const credentials = {
  email: user.email,
  password: "  password-123  ",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("authentication API contract", () => {
  it.each([
    {
      path: "/auth/signin",
      status: 200,
      body: credentials,
      call: () => signIn(credentials),
    },
    {
      path: "/auth/signup",
      status: 201,
      body: { ...credentials, displayName: user.displayName },
      call: () =>
        signUp({ ...credentials, displayName: user.displayName }),
    },
  ])("posts $path without committing the session", async test => {
    saveAccessToken("existing-test-token");
    fetchMock.mockResolvedValue(json(response, test.status));

    expect(await test.call()).toEqual(response);

    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toBe(`/api/v1${test.path}`);
    expect(options?.method).toBe("POST");
    expect(JSON.parse(options?.body as string)).toEqual(test.body);
    expect(new Headers(options?.headers).has("Authorization")).toBe(false);

    // AuthContext, rather than the adapter, commits a successful session.
    expect(getAccessToken()).toBe("existing-test-token");
  });

  it("loads the current user with the stored bearer token", async () => {
    saveAccessToken("existing-test-token");
    fetchMock.mockResolvedValue(json(user));

    expect(await getCurrentUser()).toEqual(user);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/auth/me");
    expect(new Headers(options?.headers).get("Authorization"))
      .toBe("Bearer existing-test-token");
  });

  it.each([403, 404, 500, 503])(
    "preserves the token and rejects an HTTP %i failure",
    async status => {
      saveAccessToken("existing-test-token");
      fetchMock.mockResolvedValue(
        json({ code: "EXAMPLE_ERROR", message: "Request failed." }, status),
      );

      await expect(getCurrentUser()).rejects.toMatchObject({
        statusCode: status,
      });
      expect(getAccessToken()).toBe("existing-test-token");
    },
  );

  it("preserves the token after a network failure", async () => {
    saveAccessToken("existing-test-token");
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(getCurrentUser()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    expect(getAccessToken()).toBe("existing-test-token");
  });

  it("lets the shared client invalidate an expired session", async () => {
    saveAccessToken("expired-test-token");
    fetchMock.mockResolvedValue(
      json(
        {
          code: "ACCESS_TOKEN_EXPIRED",
          message: "Access token expired.",
        },
        401,
      ),
    );

    await expect(getCurrentUser()).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(getAccessToken()).toBeNull();
  });
});
