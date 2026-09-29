import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiRequest, setStoredToken, getStoredToken } from "../../api/http-client";

describe("http-client.ts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("prefixes every request with /api/v1", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await apiRequest("/organizations");

    const actualUrl = fetchSpy.mock.calls[0][0];
    const expectedUrl = "/api/v1/organizations";

    console.log("expected URL:", expectedUrl);
    console.log("actual URL:  ", actualUrl);

    expect(actualUrl).toBe(expectedUrl);
  });

  it("attaches the Authorization header when a token is stored", async () => {
    setStoredToken("abc123");
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await apiRequest("/organizations");

    const [, init] = fetchSpy.mock.calls[0];
    const actualHeader = (init!.headers as Record<string, string>)["Authorization"];
    const expectedHeader = "Bearer abc123";

    console.log("expected Authorization header:", expectedHeader);
    console.log("actual Authorization header:  ", actualHeader);

    expect(actualHeader).toBe(expectedHeader);
  });

  it("omits the Authorization header when skipAuth is true, even with a token stored", async () => {
    setStoredToken("abc123");
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await apiRequest("/auth/signin", { skipAuth: true });

    const [, init] = fetchSpy.mock.calls[0];
    const actualHeader = (init!.headers as Record<string, string>)["Authorization"];
    const expectedHeader = undefined;

    console.log("expected Authorization header:", expectedHeader);
    console.log("actual Authorization header:  ", actualHeader);

    expect(actualHeader).toBe(expectedHeader);
  });

  it("returns undefined for a 204 No Content response, without parsing a body", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    const actual = await apiRequest("/organizations/org-1/projects/proj-1");
    const expected = undefined;

    console.log("expected result:", expected);
    console.log("actual result:  ", actual);

    expect(actual).toBe(expected);
  });

  it("throws an ApiError built from the response body on a non-2xx status", async () => {
    const errorBody = {
      statusCode: 409,
      code: "EMAIL_ALREADY_EXISTS",
      error: "Conflict",
      message: "An account with this email already exists.",
      requestId: "req_1",
    };
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(errorBody), { status: 409 }),
    );

    let actualError: unknown;
    try {
      await apiRequest("/auth/signup", { method: "POST", body: {}, skipAuth: true });
    } catch (err) {
      actualError = err;
    }

    console.log("expected thrown code:", errorBody.code);
    console.log("actual thrown code:  ", (actualError as { code?: string })?.code);

    expect(actualError).toMatchObject({
      name: "ApiError",
      statusCode: 409,
      code: "EMAIL_ALREADY_EXISTS",
    });
  });
});