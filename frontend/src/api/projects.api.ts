import { mockMemberships, mockOrganizations, mockProjects, } from "../mocks/workspace.mock";
import type { CreateProjectInput, Project } from "../types/workspace.types";
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

export async function createProject(
  organizationId: string,
  input: CreateProjectInput,
): Promise<Project> {
  await waitForMockApi();
  const currentUserId = requireAuthenticatedUserId();

    const currentMembership = mockMemberships.find(
    (membership) =>
      membership.organizationId === organizationId &&
      membership.userId === currentUserId,
  );
  if (!currentMembership) {
    throw new MockApiError(
      403,
      "You are not allowed to access this organization's projects.",
    );
  }
  if (
    currentMembership.role !== "OWNER" &&
    currentMembership.role !== "ADMIN")
    {
      throw new MockApiError(403, "You are not allowed to create projects.");
    }
    const name = input.name.trim();
  if (!name) {
    throw new MockApiError(400, "Project name is required.");
  }
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  const slugAlreadyExists = mockProjects.some(
    (project) => project.slug === slug  &&  project.organizationId === organizationId,
  );
  if (slugAlreadyExists) {
    throw new MockApiError(409, "A project already uses this slug.");
  }
  const project: Project = {
      id: `project-${mockProjects.length + 1}`,
      organizationId,
      name,
      slug,
      description: null,
      archivedAt: null,
    };
    mockProjects.push(project);
    return cloneMockValue(project);
}
