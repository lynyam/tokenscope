import type { Prisma } from "../generated/prisma/client";
import type { ApiKeySummary } from "./api-key.types";

export const API_KEY_SUMMARY_SELECT = {
  id: true,
  projectId: true,
  name: true,
  keyPrefix: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
} satisfies Prisma.ApiKeySelect;

type ApiKeySummaryRow = Prisma.ApiKeyGetPayload<{
  select: typeof API_KEY_SUMMARY_SELECT;
}>;

export function toApiKeySummary(
  row: ApiKeySummaryRow,
): ApiKeySummary {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    keyPrefix: row.keyPrefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
