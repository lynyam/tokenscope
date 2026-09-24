import type { OrganizationSummary, CreateOrganizationInput, UpdateOrganizationInput } from "../types/workspace.types";
import { apiFetch } from "./http-client";

export async function getOrganizations(): Promise<OrganizationSummary[]> {
  return apiFetch<OrganizationSummary[]>("/organizations");
}

export async function getOrganization(organizationId: string): Promise<OrganizationSummary> {
  return apiFetch<OrganizationSummary>(`/organizations/${organizationId}`);
}

export async function createOrganization(input: CreateOrganizationInput): Promise<OrganizationSummary> {
  return apiFetch<OrganizationSummary>("/organizations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateOrganization(
  organizationId: string,
  input: UpdateOrganizationInput,
): Promise<OrganizationSummary> {
  return apiFetch<OrganizationSummary>(`/organizations/${organizationId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}