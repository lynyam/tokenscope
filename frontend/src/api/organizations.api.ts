import { mockMemberships, mockOrganizations, } from "../mocks/workspace.mock";
import type { Membership, Organization, OrganizationSummary, CreateOrganizationInput } from "../types/workspace.types";
import { cloneMockValue, MockApiError, requireAuthenticatedUserId, waitForMockApi, } from "./mock-api.utils";



function createOrganizationSummary(
  organization: Organization,
  membership: Membership,
): OrganizationSummary {
  return {
    ...organization,
    currentUserRole: membership.role,
  };
}

export async function getOrganizations(): Promise<OrganizationSummary[]> {
  await waitForMockApi();
  const currentUserId = requireAuthenticatedUserId();

  const summaries = mockMemberships
    .filter(({ userId }) => userId === currentUserId)
    .map((membership) => {
      const organization = mockOrganizations.find(
        ({ id }) => id === membership.organizationId,
      );
      if (!organization) {
        throw new MockApiError(
          500,
          `Mock membership "${membership.id}" references an unknown organization.`,
        );
      }
      return createOrganizationSummary(organization, membership);
    });
    return cloneMockValue(summaries);
}

export async function getOrganization(organizationId: string,): Promise<OrganizationSummary> {
  await waitForMockApi();
  const currentUserId = requireAuthenticatedUserId();
  const organization = mockOrganizations.find(
    ({ id }) => id === organizationId,
  );
  if (!organization) {
    throw new MockApiError(404, "Organization not found.");
  }
  const currentMembership = mockMemberships.find((membership) =>
    membership.organizationId === organizationId &&
    membership.userId === currentUserId,
  );
  if (!currentMembership) {
    throw new MockApiError(
      403,
      "You are not allowed to access this organization.",
    );
  }
  return cloneMockValue(
    createOrganizationSummary(organization, currentMembership),
  );
}


//crée à la fois une nouvelle Organization ET son Membership OWNER
export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<OrganizationSummary> {
  await waitForMockApi();
  const currentUserId = requireAuthenticatedUserId();

  const name = input.name.trim();
  if (!name) {
    throw new MockApiError(400, "Organization name is required.");
  }

  const slug = name.toLowerCase().replace(/\s+/g, "-");
  const slugAlreadyExists = mockOrganizations.some(
    (organization) => organization.slug === slug,
  );
  if (slugAlreadyExists) {
    throw new MockApiError(409, "An organization already uses this slug.");
  }

  const organization: Organization = {
    id: `organization-${mockOrganizations.length + 1}`,
    name,
    slug,
  };
  mockOrganizations.push(organization);

  const membership: Membership = {
    id: `membership-${mockMemberships.length + 1}`,
    userId: currentUserId,
    organizationId: organization.id,
    role: "OWNER",
  };
  mockMemberships.push(membership);

  return cloneMockValue(createOrganizationSummary(organization, membership));
}