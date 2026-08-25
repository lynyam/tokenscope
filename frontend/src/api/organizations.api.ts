import { Organization } from '../types/workspace.types'
import { mockOrganizations } from '../mocks/workspace.mock'

//renvoi toutes les organisations qui existent dans la base de donnes
export async function getOrganizations(): Promise<Organization[]> {
    return mockOrganizations;
}




//plustard backend vas renvoie seulement celles ou l'utilisateur connecte est membre


/**
 * Leon's functions
 * 
 */

import { mockMemberships, mockOrganizations, } from "../mocks/workspace.mock";
import type { Membership, Organization, OrganizationSummary, } from "../types/workspace.types";
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