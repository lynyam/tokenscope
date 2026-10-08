import { HttpStatus, Injectable } from "@nestjs/common";
import type { Membership, MembershipRole, Prisma, } from "../generated/prisma/client";
import { ApiException } from "../common/errors/api.exception";
import { PrismaService } from "../database/prisma.service";

/*
You can call it like this in each domain
- inside transaction
await this.organizationAccess.assertOrganizationRole(
  authenticatedUserId,
  organizationId,
  [MembershipRole.OWNER],
  tx,
);
- if no transaction
await this.organizationAccess.assertOrganizationRole(
	authenticatedUserId,
	organizationId,
	[MembershipRole.OWNER],
);
*/
@Injectable()
export class OrganizationAccessService {
	constructor(private readonly prisma: PrismaService) {}

	async assertOrganizationMember(
		userId: string,
		organizationId: string,
		client: Prisma.TransactionClient = this.prisma,
	): Promise<Membership> {
		const membership = await client.membership.findUnique({
			where: {
				organizationId_userId: {
					organizationId,
					userId,
				},
			},
			select: {
				id: true,
				organizationId: true,
				userId: true,
				role: true,
				createdAt: true,
				updatedAt: true,
			},
		});

		if (!membership) {
			throw new ApiException(
				HttpStatus.NOT_FOUND,
				"ORGANIZATION_NOT_FOUND",
				"Organization not found.",
			);
		}

		return membership;
	}

	async assertOrganizationRole(
		userId: string,
		organizationId: string,
		allowedRoles: readonly MembershipRole[],
		client: Prisma.TransactionClient = this.prisma,
	): Promise<Membership> {
		const membership = await this.assertOrganizationMember(
			userId,
			organizationId,
			client,
		);

		if (!allowedRoles.includes(membership.role)) {
			throw new ApiException(
				HttpStatus.FORBIDDEN,
				"INSUFFICIENT_ORGANIZATION_ROLE",
				"You are not allowed to perform this action.",
			);
		}

		return membership;
	}
}
