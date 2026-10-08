import { HttpStatus, Injectable } from "@nestjs/common";
import type { MembershipRole, Project } from "../generated/prisma/client";
import { ApiException } from "../common/errors/api.exception";
import { PrismaService } from "../database/prisma.service";
import { OrganizationAccessService } from "../memberships/organization-access.service";

/*
Will be called like this
const project = await this.projectAccess.assertProjectAccess(
  authenticatedUserId,
  organizationId,
  projectId,
  [MembershipRole.OWNER, MembershipRole.ADMIN],
);
*/
@Injectable()
export class ProjectAccessService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly organizationAccess: OrganizationAccessService,
	) {}

	async assertProjectAccess(
		userId: string,
		organizationId: string,
		projectId: string,
		allowedRoles: readonly MembershipRole[],
	): Promise<Project> {
		try {
			await this.organizationAccess.assertOrganizationRole(
				userId,
				organizationId,
				allowedRoles,
			);
		} catch (error: unknown) {
			if (
				error instanceof ApiException &&
				error.getStatus() === HttpStatus.NOT_FOUND &&
				error.code === "ORGANIZATION_NOT_FOUND"
			) {
				throw this.projectNotFound();
			}
			throw error;
		}
		const project = await this.prisma.project.findFirst({
			where: {
				id: projectId,
				organizationId,
				archivedAt: null,
				organization: {
					memberships: {
						some: {
							userId,
							role: { in: [...allowedRoles] },
						},
					},
				},
			},
			select: {
				id: true,
				organizationId: true,
				name: true,
				slug: true,
				description: true,
				archivedAt: true,
				createdAt: true,
				updatedAt: true,
			},
		});
		if (!project) {
			throw this.projectNotFound();
		}
		return project;
	}

	private projectNotFound(): ApiException {
		return new ApiException(
			HttpStatus.NOT_FOUND,
			"PROJECT_NOT_FOUND",
			"Project not found.",
		);
	}
}
