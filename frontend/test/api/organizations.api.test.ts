import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOrganization,
  getOrganization,
  getOrganizations,
  updateOrganization, archiveOrganization
} from "@/api/organizations.api";
import { getAccessToken, saveAccessToken } from "@/api/auth-session";
import type { OrganizationSummary } from "@/types/workspace.types";

const organization: OrganizationSummary = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Acme AI",
  slug: "acme-ai",
  currentUserRole: "OWNER",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const base = "/api/v1/organizations";
const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);

  saveAccessToken("organization-test-token");

  // Prove that the adapter consumes the shared session, not the old PR key.
  localStorage.setItem("access_token", "obsolete-test-token");
});

describe("organization HTTP adapter", () => {
  it("loads list and detail using the shared token and cancellation signal", async () => {
    const controller = new AbortController();

    fetchMock
      .mockResolvedValueOnce(json([organization]))
      .mockResolvedValueOnce(json(organization));

    await expect(getOrganizations(controller.signal))
      .resolves.toEqual([organization]);

    await expect(getOrganization(organization.id, controller.signal))
      .resolves.toEqual(organization);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      base,
      expect.objectContaining({
        method: "GET",
        signal: controller.signal,
      }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${base}/${organization.id}`,
      expect.objectContaining({
        method: "GET",
        signal: controller.signal,
      }),
    );

    for (const [, options] of fetchMock.mock.calls) {
      expect(new Headers(options?.headers).get("Authorization"))
        .toBe("Bearer organization-test-token");
    }
  });

  it("preserves an empty organization list", async () => {
    fetchMock.mockResolvedValueOnce(json([]));

    await expect(getOrganizations()).resolves.toEqual([]);
  });

  it.each(["create", "rename"] as const)(
    "sends only name for %s and returns the server resource",
    async operation => {
      const controller = new AbortController();
      const result = operation === "create"
        ? organization
        : {
            ...organization,
            name: "Acme Intelligence",
            updatedAt: "2026-09-02T00:00:00.000Z",
          };

      const input = {
        name: result.name,
        slug: "must-not-be-sent",
        currentUserRole: "OWNER",
      };

      fetchMock.mockResolvedValueOnce(
        json(result, operation === "create" ? 201 : 200),
      );

      const request = operation === "create"
        ? createOrganization(input, controller.signal)
        : updateOrganization(organization.id, input, controller.signal);

      await expect(request).resolves.toEqual(result);

      expect(fetchMock).toHaveBeenCalledWith(
        operation === "create" ? base : `${base}/${organization.id}`,
        expect.objectContaining({
          method: operation === "create" ? "POST" : "PATCH",
          body: JSON.stringify({ name: input.name }),
          signal: controller.signal,
        }),
      );
    },
  );

  it("encodes organization IDs as one path segment", async () => {
    const id = "organization/with ?#characters";

    fetchMock.mockImplementation(async () => json(organization));

    await getOrganization(id);
    await updateOrganization(id, { name: "New name" });

    for (const [url] of fetchMock.mock.calls) {
      expect(url).toBe(`${base}/${encodeURIComponent(id)}`);
    }
  });

  it.each([
    [
      403,
      "INSUFFICIENT_ORGANIZATION_ROLE",
      () => updateOrganization(organization.id, { name: "New name" }),
    ],
    [
      404,
      "ORGANIZATION_NOT_FOUND",
      () => getOrganization(organization.id),
    ],
    [
      409,
      "ORGANIZATION_SLUG_CONFLICT",
      () => createOrganization({ name: organization.name }),
    ],
  ] as const)(
    "propagates %i %s without clearing authentication",
    async (status, code, call) => {
      fetchMock.mockResolvedValueOnce(
        json(
          { code, message: "Request rejected.", requestId: "organization-1" },
          status,
        ),
      );

      await expect(call()).rejects.toMatchObject({
        statusCode: status,
        code,
        requestId: "organization-1",
      });

      expect(getAccessToken()).toBe("organization-test-token");
    },
  );

  it("lets the shared client invalidate a protected 401", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          code: "ACCESS_TOKEN_EXPIRED",
          message: "Access token expired.",
        },
        401,
      ),
    );

    await expect(getOrganizations()).rejects.toMatchObject({
      statusCode: 401,
    });

    expect(getAccessToken()).toBeNull();
  });
  it("sends only confirmSlug exactly as typed and accepts 204", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(archiveOrganization(organization.id, " Acme-AI ", controller.signal))
      .resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      `${base}/${organization.id}`,
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ confirmSlug: " Acme-AI " }),
        signal: controller.signal,
      }),
    );

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer organization-test-token");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it.each([
    [409, "ORGANIZATION_CONFIRMATION_MISMATCH"],
    [409, "CONCURRENT_MODIFICATION"],
    [403, "INSUFFICIENT_ORGANIZATION_ROLE"],
    [404, "ORGANIZATION_NOT_FOUND"],
  ] as const)(
    "propagates archive %i %s without clearing authentication",
    async (status, code) => {
      fetchMock.mockResolvedValueOnce(
        json({ code, message: "Request rejected.", requestId: "archive-1" }, status),
      );

      await expect(archiveOrganization(organization.id, "acme-ai"))
        .rejects.toMatchObject({ statusCode: status, code, requestId: "archive-1" });

      expect(getAccessToken()).toBe("organization-test-token");
    },
  );

  it("encodes the organization ID as one path segment when archiving", async () => {
    const id = "organization/with ?#characters";
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await archiveOrganization(id, "acme-ai");

    expect(fetchMock.mock.calls[0][0]).toBe(`${base}/${encodeURIComponent(id)}`);
  });
});
