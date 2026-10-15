import type { Prisma } from "../generated/prisma/client";
import type { ApiKeyPrincipal } from "../api-keys/api-key.types";

export function publicTraceScope(
	principal: ApiKeyPrincipal,
): Prisma.TraceWhereInput {
	return {
		projectId: principal.projectId,
		deletedAt: null,
		project: {
			archivedAt: null,
			organization: {
				archivedAt: null,
			},
			apiKeys: {
				some: {
					id: principal.keyId,
					revokedAt: null,
				},
			},
		},
	};
}

export function browserTraceScope(
	actorId: string,
	organizationId: string,
	projectId: string,
): Prisma.TraceWhereInput {
	return {
		projectId,
		deletedAt: null,
		project: {
			organizationId,
			archivedAt: null,
			organization: {
				archivedAt: null,
				memberships: {
					some: { userId: actorId },
				},
			},
		},
	};
}