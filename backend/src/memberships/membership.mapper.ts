import type { MembershipRole, Prisma } from "../generated/prisma/client";

export const membershipSelect = {
	id: true,
	userId: true,
	organizationId: true,
	role: true,
	createdAt: true,
	updatedAt: true,
	user: {
		select: {
			id: true,
			email: true,
			displayName: true,
		},
	},
} as const satisfies Prisma.MembershipSelect;

export type MembershipRecord = Prisma.MembershipGetPayload<{
	select: typeof membershipSelect;
}>;

export interface MembershipResponse {
	id: string;
	userId: string;
	organizationId: string;
	role: MembershipRole;
	createdAt: string;
	updatedAt: string;
	user: {
		id: string;
		email: string;
		displayName: string;
	};
}

export interface MembershipListResponse {
	memberships: MembershipResponse[];
	currentUserRole: MembershipRole;
}

export function toMembershipResponse(
	membership: MembershipRecord,
): MembershipResponse {
	return {
		id: membership.id,
		userId: membership.userId,
		organizationId: membership.organizationId,
		role: membership.role,
		createdAt: membership.createdAt.toISOString(),
		updatedAt: membership.updatedAt.toISOString(),
		user: {
			id: membership.user.id,
			email: membership.user.email,
			displayName: membership.user.displayName,
		},
	};
}
