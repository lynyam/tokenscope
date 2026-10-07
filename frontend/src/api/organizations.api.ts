import { apiGet, apiPost, apiPatch, apiDeleteWithBody } from "./http-client";
import type {
    OrganizationSummary,
    CreateOrganizationInput,
    UpdateOrganizationInput,
    ArchiveOrganizationInput,
} from "../types/workspace.types";

// Authentication, /api/v1, JSON and errors belong to the shared client.
// This adapter only describes the organization endpoints.
export async function getOrganizations(signal?: AbortSignal, ): Promise<OrganizationSummary[]> {
    return apiGet<OrganizationSummary[]>("/organizations", { signal });
}

export async function getOrganization(organizationId: string, signal?: AbortSignal,): Promise<OrganizationSummary> {
    return apiGet<OrganizationSummary>(`/organizations/${encodeURIComponent(organizationId)}`, { signal },);
}

export async function createOrganization(input: CreateOrganizationInput, signal?: AbortSignal,): Promise<OrganizationSummary> {
    return apiPost<OrganizationSummary>(
      "/organizations",
      // API.md accepts only name. IDs, slug and initial ownership are server-owned.
      { name: input.name },
      { signal },
    );
}

export async function updateOrganization(
    organizationId: string,
    input: UpdateOrganizationInput,
    signal?: AbortSignal,
): Promise<OrganizationSummary> {
    return apiPatch<OrganizationSummary>(
      `/organizations/${encodeURIComponent(organizationId)}`,
      // Renaming changes the name; the backend preserves the existing slug.
      { name: input.name },
      { signal },
    );
}

export async function archiveOrganization(
    organizationId: string,
    input: ArchiveOrganizationInput,
    signal?: AbortSignal,
): Promise<void> {
    return apiDeleteWithBody(
        `/organizations/${encodeURIComponent(organizationId)}`,
        { confirmSlug: input.confirmSlug },
        { signal },
    );
}
