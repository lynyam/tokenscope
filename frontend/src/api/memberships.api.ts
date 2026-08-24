/*import { Member } from '../types/workspace.types'
import { mockMembers } from '../mocks/workspace.mock'

//pour l'instant renvoie tous les mocks; une fois plusieurs organisations
//dans le mock, filtrer mockMembers selon organizationId
export async function getMembers(organizationId: string): Promise<Member[]> {
    return mockMembers;
}



//cette fonction devra filtrer les membres selon l'organisation demandée
*/

import { mockMemberships, mockOrganizations, mockUsers, } from "../mocks/workspace.mock";
import type { MembershipWithUser, OrganizationMembershipsResponse, } from "../types/workspace.types";
import { cloneMockValue, MockApiError, requireAuthenticatedUserId, waitForMockApi, } from "./mock-api.utils";

export async function getOrganizationMemberships(organizationId: string,
  ): Promise<OrganizationMembershipsResponse> {
  await waitForMockApi();
  const currentUserId = "user-alice"//requireAuthenticatedUserId();
  const organizationExists = mockOrganizations.some(
    ({ id }) => id === organizationId,
  );
  if (!organizationExists) {
    throw new MockApiError(404, "Organization not found.");
  }
  const currentMembership = mockMemberships.find((membership) =>
    membership.organizationId === organizationId &&
    membership.userId === currentUserId,
  );
  if (!currentMembership) {
    throw new MockApiError(403,
      "You are not allowed to access this organization's members.",
    );
  }
  const memberships: MembershipWithUser[] = mockMemberships.filter(
    (membership) => membership.organizationId === organizationId,).map((membership) => {
      const user = mockUsers.find(({ id }) => id === membership.userId);
      if (!user) {
        throw new MockApiError(
          500,
          `Mock membership "${membership.id}" references an unknown user.`,
        );
      }
      return {...membership, user,};
    }
  );
  return cloneMockValue({memberships, currentUserRole: currentMembership.role,});
}
