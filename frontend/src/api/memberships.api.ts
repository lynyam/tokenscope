import { apiDelete, apiGet, apiPatch, apiPost } from "./http-client";
import type {
  AddOrganizationMemberInput,
  MembershipWithUser,
  OrganizationMembershipsResponse,
  UpdateMemberRoleInput,
} from "../types/workspace.types";

// API.md: the path is /members; mutation targets are user IDs, not membership IDs.
export function getOrganizationMemberships(
  organizationId: string,
  signal?: AbortSignal,
): Promise<OrganizationMembershipsResponse> {
  return apiGet<OrganizationMembershipsResponse>(
    `/organizations/${encodeURIComponent(organizationId)}/members`, { signal },
  );
}

export function addOrganizationMember(
  organizationId: string,
  input: AddOrganizationMemberInput,
  signal?: AbortSignal,
): Promise<MembershipWithUser> {
  return apiPost<MembershipWithUser>(
    `/organizations/${encodeURIComponent(organizationId)}/members`,
    { email: input.email, ...(input.role === undefined ? {} : { role: input.role }) },
    { signal },
  );
}

export function updateOrganizationMemberRole(
  organizationId: string,
  userId: string,
  input: UpdateMemberRoleInput,
  signal?: AbortSignal,
): Promise<MembershipWithUser> {
  return apiPatch<MembershipWithUser>(
    `/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
    { role: input.role }, { signal },
  );
}

export function removeOrganizationMember(
  organizationId: string,
  userId: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiDelete(
    `/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`, { signal },
  );
}
