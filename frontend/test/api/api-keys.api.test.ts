import { beforeEach, expect, it, vi } from "vitest";
import {
  createProjectApiKey,
  listProjectApiKeys,
  revokeProjectApiKey,
} from "@/api/api-keys.api";
import { saveAccessToken } from "@/api/auth-session";
import type { ApiKeySummary, CreatedApiKey } from "@/types/api-key.types";

const organizationId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const apiKeyId = "00000000-0000-4000-8000-000000000003";

const summary: ApiKeySummary = {
  id: apiKeyId,
  projectId,
  name: "CI",
  keyPrefix: "ts_test_ab",
  createdAt: "2026-09-01T00:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
};

// Obviously fake: never use a real key in tests.
const created: CreatedApiKey = { ...summary, key: "ts_test_PLACEHOLDER_NOT_A_REAL_KEY" };

const base =
  "/api/v1/organizations/" + organizationId + "/projects/" + projectId + "/api-keys";

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  saveAccessToken("api-key-token");
});

it("uses the three endpoints with the shared token and signal", async () => {
  const controller = new AbortController();
  fetchMock
    .mockResolvedValueOnce(json([summary]))
    .mockResolvedValueOnce(json(created, 201))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));

  expect(await listProjectApiKeys(organizationId, projectId, controller.signal))
    .toEqual([summary]);
  expect(
    await createProjectApiKey(organizationId, projectId, { name: "CI" }, controller.signal),
  ).toEqual(created);
  expect(
    await revokeProjectApiKey(organizationId, projectId, apiKeyId, controller.signal),
  ).toBeUndefined();

  expect(
    fetchMock.mock.calls.map(([url, options]) => [url, options?.method]),
  ).toEqual([
    [base, "GET"],
    [base, "POST"],
    [base + "/" + apiKeyId, "DELETE"],
  ]);

  for (const [, options] of fetchMock.mock.calls) {
    expect(new Headers(options?.headers).get("Authorization"))
      .toBe("Bearer api-key-token");
    expect(options?.signal).toBe(controller.signal);
  }

  expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
  expect(fetchMock.mock.calls[2][1]?.body).toBeUndefined();
});

it("trims the name before sending it", async () => {
  fetchMock.mockResolvedValueOnce(json(created, 201));

  await createProjectApiKey(organizationId, projectId, { name: "  CI  " });

  expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ name: "CI" }));
});

it("encodes every path segment", async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

  await revokeProjectApiKey("org/1", "proj?2", "key#3");

  expect(fetchMock.mock.calls[0][0]).toBe(
    "/api/v1/organizations/org%2F1/projects/proj%3F2/api-keys/key%233",
  );
});

it("rejects with the server error code when the key is unknown", async () => {
  fetchMock.mockResolvedValueOnce(
    json({ code: "API_KEY_NOT_FOUND", message: "API key not found." }, 404),
  );

  await expect(revokeProjectApiKey(organizationId, projectId, apiKeyId))
    .rejects.toMatchObject({ statusCode: 404, code: "API_KEY_NOT_FOUND" });
});

it("does not put the key in a failed creation error", async () => {
  fetchMock.mockResolvedValueOnce(
    json({ code: "VALIDATION_ERROR", message: "Invalid request." }, 400),
  );

  const failure = await createProjectApiKey(organizationId, projectId, { name: "x" })
    .catch((error: unknown) => error);

  expect(JSON.stringify(failure)).not.toContain("PLACEHOLDER");
});
