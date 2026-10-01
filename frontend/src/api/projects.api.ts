import { apiDelete, apiGet, apiPatch, apiPost } from "./http-client";
import { notifyProjectsChanged } from "./project-events";
import type {
  CreateProjectInput,
  Project,
  UpdateProjectInput,
} from "../types/workspace.types";

export function getOrganizationProjects(
  organizationId: string,
  signal?: AbortSignal,
) {
  return apiGet<Project[]>(
    "/organizations/" + encodeURIComponent(organizationId) + "/projects",
    { signal },
  );
}

export function getOrganizationProject(
  organizationId: string,
  projectId: string,
  signal?: AbortSignal,
) {
  return apiGet<Project>(
    "/organizations/" +
      encodeURIComponent(organizationId) +
      "/projects/" +
      encodeURIComponent(projectId),
    { signal },
  );
}

export async function createProject(
  organizationId: string,
  input: CreateProjectInput,
  signal?: AbortSignal,
) {
  const project = await apiPost<Project>(
    "/organizations/" + encodeURIComponent(organizationId) + "/projects",
    {
      name: input.name,
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
    },
    { signal },
  );

  // A completed request from a screen we left must not update current views.
  signal?.throwIfAborted();

  notifyProjectsChanged({
    organizationId,
    kind: "upsert",
    project,
  });

  return project;
}

export async function updateProject(
  organizationId: string,
  projectId: string,
  input: UpdateProjectInput,
  signal?: AbortSignal,
) {
  const project = await apiPatch<Project>(
    "/organizations/" +
      encodeURIComponent(organizationId) +
      "/projects/" +
      encodeURIComponent(projectId),
    {
      // Omitted means unchanged; null explicitly clears the description.
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
    },
    { signal },
  );

  signal?.throwIfAborted();

  notifyProjectsChanged({
    organizationId,
    kind: "upsert",
    project,
  });

  return project;
}

export async function archiveProject(
  organizationId: string,
  projectId: string,
  signal?: AbortSignal,
): Promise<void> {
  await apiDelete(
    "/organizations/" +
      encodeURIComponent(organizationId) +
      "/projects/" +
      encodeURIComponent(projectId),
    { signal },
  );

  signal?.throwIfAborted();

  // DELETE returns 204
  notifyProjectsChanged({
    organizationId,
    kind: "archive",
    projectId,
  });
}
