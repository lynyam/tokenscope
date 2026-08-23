/*import { Project } from '../types/workspace.types'
import { mockProjects } from '../mocks/workspace.mock'


//cette fonction renvoie la liste de tous les projets d'une organization
export async function getProjects(organizationId: string): Promise<Project[]> {
    return mockProjects;
}
*/

import { mockMemberships, mockOrganizations, mockProjects, } from "../mocks/workspace.mock";
import type { Project } from "../types/workspace.types";
import { cloneMockValue, MockApiError, requireAuthenticatedUserId, waitForMockApi, } from "./mock-api.utils";

function assertOrganizationAccess(organizationId: string, currentUserId: string,): void {
  const organizationExists = mockOrganizations.some(
    ({ id }) => id === organizationId,
  );
  if (!organizationExists) {
    throw new MockApiError(404, "Organization not found.");
  }
  const canAccessOrganization = mockMemberships.some(
    (membership) => membership.organizationId === organizationId &&
      membership.userId === currentUserId,
  );
  if (!canAccessOrganization) {
    throw new MockApiError(
      403,
      "You are not allowed to access this organization's projects.",
    );
  }
}

export async function getOrganizationProjects(organizationId: string,): Promise<Project[]> {
  await waitForMockApi();
  const currentUserId = requireAuthenticatedUserId();
  assertOrganizationAccess(organizationId, currentUserId);
  const projects = mockProjects.filter(
    (project) => project.organizationId === organizationId,);
    return cloneMockValue(projects);
}

export async function getOrganizationProject(organizationId: string, projectId: string,): Promise<Project> {
  await waitForMockApi();
  const currentUserId = requireAuthenticatedUserId();
  assertOrganizationAccess(organizationId, currentUserId);
  const project = mockProjects.find((candidate) =>
    candidate.organizationId === organizationId &&
    candidate.id === projectId,
  );
  if (!project) {
    throw new MockApiError(404, "Project not found.");
  }
  return cloneMockValue(project);
}
