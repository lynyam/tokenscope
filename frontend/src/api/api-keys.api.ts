import { apiDelete, apiGet, apiPost } from "./http-client";
import type {
  ApiKeySummary,
  CreateApiKeyInput,
  CreatedApiKey,
} from "../types/api-key.types";

function apiKeysPath(organizationId: string, projectId: string) {
  return (
    "/organizations/" +
    encodeURIComponent(organizationId) +
    "/projects/" +
    encodeURIComponent(projectId) +
    "/api-keys"
  );
}

export function listProjectApiKeys(
  organizationId: string,
  projectId: string,
  signal?: AbortSignal,
) {
  return apiGet<ApiKeySummary[]>(apiKeysPath(organizationId, projectId), {
    signal,
  });
}

export function createProjectApiKey(
  organizationId: string,
  projectId: string,
  input: CreateApiKeyInput,
  signal?: AbortSignal,
) {
  // Only the normalized name is sent. Mutations are never retried here.
  return apiPost<CreatedApiKey>(
    apiKeysPath(organizationId, projectId),
    { name: input.name.trim() },
    { signal },
  );
}

export function revokeProjectApiKey(
  organizationId: string,
  projectId: string,
  apiKeyId: string,
  signal?: AbortSignal,
) {
  return apiDelete(
    apiKeysPath(organizationId, projectId) +
      "/" +
      encodeURIComponent(apiKeyId),
    { signal },
  );
}