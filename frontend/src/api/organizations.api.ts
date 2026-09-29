import { apiGet, apiPost, apiPatch } from "./http-client";
import type {
    OrganizationSummary,
    CreateOrganizationInput,
    UpdateOrganizationInput,
} from "../types/workspace.types";

export async function getOrganizations(): Promise<OrganizationSummary[]> {
    return apiGet<OrganizationSummary[]>("/organizations");
}

export async function getOrganization(organizationId: string): Promise<OrganizationSummary> {
    return apiGet<OrganizationSummary>(`/organizations/${organizationId}`);
}

export async function createOrganization(input: CreateOrganizationInput): Promise<OrganizationSummary> {
    return apiPost<OrganizationSummary>("/organizations", input);
}

export async function updateOrganization(
    organizationId: string,
    input: UpdateOrganizationInput,
): Promise<OrganizationSummary> {
    return apiPatch<OrganizationSummary>(`/organizations/${organizationId}`, input);
}