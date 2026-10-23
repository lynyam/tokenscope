export interface ApiKeySummary {
  id: string;
  projectId: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreateApiKeyInput {
  name: string;
}

// Only the creation response carries the one-time secret.
export interface CreatedApiKey extends ApiKeySummary {
  key: string;
}