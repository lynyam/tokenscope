import type { Request } from "express";

export type ApiKeySummary = {
  id: string;
  projectId: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type CreatedApiKey = ApiKeySummary & {
  key: string;
};

// An API key identifies a project credential, not a logged-in user.
// Never attach the secret or digest to this principal.
export type ApiKeyPrincipal = Readonly<{
  keyId: string;
  projectId: string;
}>;

export type ApiKeyRequest = Request & {
  apiKey?: ApiKeyPrincipal;
};
