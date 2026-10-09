import { beforeEach, describe, expect, it, vi } from "vitest";
import { addOrganizationMember, getOrganizationMemberships, removeOrganizationMember, updateOrganizationMemberRole } from "@/api/memberships.api";
import { getAccessToken, saveAccessToken } from "@/api/auth-session";

const orgId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const base = "/api/v1/organizations/" + orgId + "/members";
const fetchMock = vi.fn<typeof fetch>();
const member = {
  id: "00000000-0000-4000-8000-000000000003", organizationId: orgId, userId, role: "MEMBER",
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  user: { id: userId, email: "bob@example.test", displayName: "Bob" },
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  saveAccessToken("member-test-token");
});

describe("membership HTTP adapter", () => {
  it("gets the list envelope and forwards cancellation", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue(response({ memberships: [member], currentUserRole: "OWNER" }));
    await expect(getOrganizationMemberships(orgId, controller.signal))
      .resolves.toEqual({ memberships: [member], currentUserRole: "OWNER" });
    expect(fetchMock).toHaveBeenCalledWith(base, expect.objectContaining({ method: "GET", signal: controller.signal }));
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer member-test-token");
  });

  it("posts only email and an optional role, letting the backend default to MEMBER", async () => {
    fetchMock.mockResolvedValue(response(member, 201));
    const input = { email: "bob@example.test", userId: "injected-actor", organizationId: "injected-org" };
    await expect(addOrganizationMember(orgId, input)).resolves.toEqual(member);
    expect(fetchMock).toHaveBeenCalledWith(base, expect.objectContaining({
      method: "POST", body: JSON.stringify({ email: input.email }),
    }));
  });

  it("posts an explicitly chosen role", async () => {
    fetchMock.mockResolvedValue(response({ ...member, role: "ADMIN" }, 201));
    await addOrganizationMember(orgId, { email: member.user.email, role: "ADMIN" });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ email: member.user.email, role: "ADMIN" });
  });

  it("patches by userId and sends only role", async () => {
    fetchMock.mockResolvedValue(response({ ...member, role: "ADMIN" }));
    await updateOrganizationMemberRole(orgId, userId, { role: "ADMIN" });
    expect(fetchMock).toHaveBeenCalledWith(base + "/" + userId, expect.objectContaining({
      method: "PATCH", body: '{"role":"ADMIN"}',
    }));
  });

  it("deletes by userId and returns void for 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(removeOrganizationMember(orgId, userId)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(base + "/" + userId, expect.objectContaining({ method: "DELETE", body: undefined }));
  });

  it.each([
    [403, "INSUFFICIENT_ORGANIZATION_ROLE"],
    [404, "ORGANIZATION_NOT_FOUND"],
    [404, "MEMBERSHIP_NOT_FOUND"],
    [409, "LAST_OWNER_REQUIRED"],
  ])("propagates %i %s without invalidating authentication", async (status, code) => {
    fetchMock.mockResolvedValue(response({ code, message: "Request rejected.", requestId: "membership-1" }, status));
    await expect(removeOrganizationMember(orgId, userId)).rejects.toMatchObject({ statusCode: status, code, requestId: "membership-1" });
    expect(getAccessToken()).toBe("member-test-token");
  });
});
