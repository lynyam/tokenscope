import { Prisma } from "../generated/prisma/client";
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

// SQL equivalent of browserTraceScope, using the fixed trace alias t.
//
// EXISTS avoids multiplying traces by the organization's membership count.
export function browserTraceScopeSql(
	actorId: string,
	organizationId: string,
	projectId: string,
): Prisma.Sql {
	return Prisma.sql`
		t."projectId" = ${projectId}
		AND t."deletedAt" IS NULL

		AND EXISTS (
			SELECT 1
			FROM "Project" p
			JOIN "Organization" o
				ON o.id = p."organizationId"

			WHERE p.id = t."projectId"
				AND p."organizationId" = ${organizationId}
				AND p."archivedAt" IS NULL
				AND o."archivedAt" IS NULL

				AND EXISTS (
					SELECT 1
					FROM "Membership" m
					WHERE m."organizationId" = o.id
						AND m."userId" = ${actorId}
				)
		)
	`;
}
