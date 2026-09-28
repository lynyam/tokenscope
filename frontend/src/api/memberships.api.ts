import { mockMemberships, mockOrganizations, mockUsers, } from "../mocks/workspace.mock";
import type { AddOrganizationMemberInput, Membership, MembershipWithUser, OrganizationMembershipsResponse } from "../types/workspace.types";
import { cloneMockValue, MockApiError, requireAuthenticatedUserId, waitForMockApi, } from "./mock-api.utils";
import { UpdateMemberRoleInput } from "../types/workspace.types"

export async function getOrganizationMemberships(organizationId: string,
  ): Promise<OrganizationMembershipsResponse> {
  await waitForMockApi();
  const currentUserId = requireAuthenticatedUserId();
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

//POST
export async function addOrganizationMember(organizationId: string,
  input: AddOrganizationMemberInput,) : Promise<MembershipWithUser> {
  // TODO(TSE-43): migrate to the shared HTTP client once available; still mock-backed for now.
    await waitForMockApi();
  //2-Récupérer currentUserId
  const currentUserId = requireAuthenticatedUserId();
  // 3-Vérifier que l'organisation existe → sinon 404
  const organizationExists = mockOrganizations.some(({id}) => id === organizationId);
  if (!organizationExists)
  {
    throw new MockApiError(404, "Organization not found.");
  }
  // 4-Vérifier que l'utilisateur courant est OWNER de cette organisation → sinon quel code erreur ? (Attention : getOrganizationMemberships vérifie juste "est membre", mais ici le contrat exige un rôle précis — lequel, et donc quelle vérification différente faut-il faire ?)
  const currentMembership = mockMemberships.find((membership) => membership.organizationId === organizationId && membership.userId === currentUserId,);
  if (!currentMembership || currentMembership.role !== "OWNER")
  {
    throw new MockApiError(403, "You must be an OWNER to add a member.")
  }
  // 5-Chercher l'utilisateur cible par email dans mockUsers → si introuvable, quel code erreur exact (regarde la liste dans le contrat) ?
  const targetuser = mockUsers.find(({email}) => email === input.email);
  if (!targetuser)
  {
    throw new MockApiError(404, "User not found.");
  }
  // 6-Vérifier qu'une membership n'existe pas déjà pour cet utilisateur dans cette organisation → sinon quel code ?
  const existingMembership = mockMemberships.find((membership) =>
  membership.organizationId === organizationId &&
  membership.userId === targetuser.id,
  );
  if (existingMembership)
  {
    throw new MockApiError(409, "Membership already exists");
  }
  // 7-Construire la nouvelle membership (avec le rôle par défaut si non fourni — lequel ?)
  const membership: Membership = {
    id: `membership-${mockMemberships.length + 1}`,
    userId: targetuser.id,
    organizationId,
    role: input.role ?? "MEMBER",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  // 8-L'ajouter à mockMemberships
  mockMemberships.push(membership);
  // 9-Retourner la membership enrichie avec les données utilisateur, via cloneMockValue
  return cloneMockValue({...membership, user: targetuser,});
}


//fonction pour faire les changements de role (niveau necessaire: owner)
export async function updateOrganizationMemberRole(
  organizationId: string,
  userId: string,
  input: UpdateMemberRoleInput,
): Promise<MembershipWithUser> {
  // TODO(TSE-43): migrate to the shared HTTP client once available; still mock-backed for now.
  await waitForMockApi();
  const currentUserId = requireAuthenticatedUserId();

  // 1. L'organisation existe ?
  const organizationExists = mockOrganizations.some(({ id }) => id === organizationId);
  if (!organizationExists) {
    throw new MockApiError(404, "Organization not found.");
  }

  // 2. L'utilisateur courant est OWNER de cette organisation ?
  const currentMembership = mockMemberships.find(
    (membership) => membership.organizationId === organizationId && membership.userId === currentUserId,
  );
  if (!currentMembership || currentMembership.role !== "OWNER") {
    throw new MockApiError(403, "You must be an OWNER to change a member's role.");
  }

  // 3. La membership ciblée (userId de l'URL) existe dans cette organisation ?
  const targetMembership = mockMemberships.find(
    (membership) => membership.organizationId === organizationId && membership.userId === userId,
  );
  if (!targetMembership) {
    throw new MockApiError(404, "Membership not found.");
  }

  // 4. Invariant "dernier OWNER"
  const ownerCount = mockMemberships.filter(
    (membership) => membership.organizationId === organizationId && membership.role === "OWNER",
  ).length;

  const isDemotingLastOwner =
    targetMembership.role === "OWNER" &&   // elle est OWNER en ce moment
    input.role !== "OWNER" &&              // et on veut la faire passer à autre chose
    ownerCount === 1;                      // et c'est la seule OWNER de l'organisation

  if (isDemotingLastOwner) {
    throw new MockApiError(409, "The last owner of an organization cannot be demoted.");
  }

  // 5. Appliquer le changement
  targetMembership.role = input.role;
  targetMembership.updatedAt = new Date().toISOString();

  // 6. Enrichir avec les données utilisateur et retourner
  const user = mockUsers.find(({ id }) => id === targetMembership.userId);
  if (!user) {
    throw new MockApiError(500, `Mock membership "${targetMembership.id}" references an unknown user.`);
  }
  return cloneMockValue({ ...targetMembership, user });
}

//fonction gere lesconditions necessaires pour  pouvoir retirer un un membre
export async function removeOrganizationMember(
  organizationId: string,
  userId: string,
): Promise<void> {
  // TODO(TSE-43): migrate to the shared HTTP client once available; still mock-backed for now.
  await waitForMockApi();
  const currentUserId = requireAuthenticatedUserId();

  const organizationExists = mockOrganizations.some(({ id }) => id === organizationId);
  if (!organizationExists) {
    throw new MockApiError(404, "Organization not found.");
  }

  const currentMembership = mockMemberships.find(
    (membership) => membership.organizationId === organizationId && membership.userId === currentUserId,
  );
  if (!currentMembership || currentMembership.role !== "OWNER") {
    throw new MockApiError(403, "You must be an OWNER to remove a member.");
  }

  const targetIndex = mockMemberships.findIndex(
    (membership) => membership.organizationId === organizationId && membership.userId === userId,
  );
  if (targetIndex === -1) {
    throw new MockApiError(404, "Membership not found.");
  }
  const targetMembership = mockMemberships[targetIndex];
  const ownerCount = mockMemberships.filter(
    (membership) => membership.organizationId === organizationId && membership.role === "OWNER",
  ).length;
  const isRemovingLastOwner = targetMembership.role === "OWNER" && ownerCount === 1;
  if (isRemovingLastOwner) {
    throw new MockApiError(409, "The last owner of an organization cannot be removed.");
  }
  mockMemberships.splice(targetIndex, 1);
}