import { HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ApiException } from '../common/errors/api.exception';
import { CreateOrganizationDto } from "./dto/create-organization.dto";
import { RenameOrganizationDto } from "./dto/rename-organization.dto";
import { OrganizationAccessService } from "../memberships/organization-access.service";
import { Prisma } from "../generated/prisma/client";
import { MembershipRole } from "../generated/prisma/enums";
import { Organization } from "../generated/prisma/client";
import { ArchiveOrganizationDto } from "./dto/archive-organization.dto";

const MAX_TRANSACTION_ATTEMPTS = 3;

@Injectable()
export class OrganizationsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly organizationAccess: OrganizationAccessService,
	) {}

	async findAllForUser(userId: string) {
		const memberships = await this.prisma.membership.findMany({
			where: {
				userId,
				organization: {
				  archivedAt: null,
				},
			},
			include: { organization: true },
			orderBy: [
				{ organization: { createdAt: "asc"} },
				{ organization: { id: "asc" } }
			],
		});
		return memberships.map(({
			organization, role }) => this.toSummary(organization, role));
	}

	async findOneForUser(userId: string, organizationId: string) {
		await this.organizationAccess.assertOrganizationMember(userId, organizationId);
		// The final read still requires the same user's membership
		const membership = await this.prisma.membership.findUnique({
			where: {
				organizationId_userId: {
				  organizationId,
				  userId,
				},
				organization: {
				  archivedAt: null,
				},
			},
			include: {organization: true},
		});

		if (!membership) throw this.notFound();
		return this.toSummary(membership.organization, membership.role);
	}

	async create(userId: string, dto: CreateOrganizationDto) {
		const name = dto.name; //No need trim and check because global validator already did it
		const slug = name.toLowerCase().replace(/\s+/g, "-");

		try {
			const organization = await this.prisma.organization.create({
				data: {
					name,
					slug,
					memberships: {
						create: {
							userId,
							role: MembershipRole.OWNER,
						},
					},
				},
			});
			return this.toSummary(organization, MembershipRole.OWNER);
		} catch (error) {
			if (this.isSlugConflict(error)) {
				throw new ApiException(
					HttpStatus.CONFLICT,
					"ORGANIZATION_SLUG_CONFLICT",
					"An organization already uses this slug.",
				);
			}
			throw error;
		}
	}

	async rename(userId: string, organizationId: string, dto: RenameOrganizationDto) {
		await this.organizationAccess.assertOrganizationRole(
			userId, organizationId, [MembershipRole.OWNER],
		);

		try {
			// The write itself retains the actor and required role.
			const organization = await this.prisma.organization.update({
				where: {
					id: organizationId,
					archivedAt: null,
					memberships: {
					  some: {
						userId,
						role: MembershipRole.OWNER,
					  },
					},
				},
				data: { name: dto.name },
			});
			return this.toSummary(organization, MembershipRole.OWNER);
		} catch (error) {
			if (
				error instanceof Prisma.PrismaClientKnownRequestError &&
				error.code === "P2025"
			) {
				// Resolve lost membership to 404 and lost OWNER status to 403.
				await this.organizationAccess.assertOrganizationRole(
					userId, organizationId, [MembershipRole.OWNER],
				)
				// Access may have changed again; do not retry an unauthorized write.
				throw this.notFound();
			}
			throw error;
		}
	}
	async archive(userId: string, organizationId: string, dto: ArchiveOrganizationDto): Promise<void> {
		await this.runSerializable(async (tx) => {
			// Authorization comes first, so an outsider never learns whether the slug matches.
			await this.organizationAccess.assertOrganizationRole(
				userId, organizationId, [MembershipRole.OWNER], tx,
			);

			const organization = await tx.organization.findFirst({
				where: { id: organizationId, archivedAt: null },
				select: { slug: true },
			});
			if (!organization) {
				throw this.notFound();
			}

			// Exact comparison: no trim, no lowercase.
			if (dto.confirmSlug !== organization.slug) {
				throw new ApiException(
					HttpStatus.CONFLICT,
					"ORGANIZATION_CONFIRMATION_MISMATCH",
					"The confirmation does not match the organization slug.",
				);
			}

			try {
				// The write itself retains the actor and required role.
				await tx.organization.update({
					where: {
						id: organizationId,
						archivedAt: null,
						memberships: { some: { userId, role: MembershipRole.OWNER } },
					},
					data: { archivedAt: new Date() },
				});
			} catch (error) {
				if (
					error instanceof Prisma.PrismaClientKnownRequestError &&
					error.code === "P2025"
				) {
					// Resolve lost membership to 404 and lost OWNER status to 403.
					await this.organizationAccess.assertOrganizationRole(
						userId, organizationId, [MembershipRole.OWNER], tx,
					);
					throw this.notFound();
				}
				throw error;
			}
		});
	}

	private toSummary(organization: Organization, role: MembershipRole) {
		return {
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
			currentUserRole: role,
			createdAt: organization.createdAt,
			updatedAt: organization.updatedAt,
		};
	}

	private notFound() {
		return new ApiException(
			HttpStatus.NOT_FOUND,
			"ORGANIZATION_NOT_FOUND",
			"Organization not found.",
		);
	}

	private isSlugConflict(error: unknown): boolean {
		if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
			return false;
		}
		const meta = error.meta as {
			modelName?: string;
			target?: unknown;
			driverAdapterError?: {
				cause?: { kind?: string; constraint?: { fields?: unknown } };
			};
		} | undefined;
		if (meta?.modelName && meta.modelName !== "Organization") {
			return false;
		}
		if (meta?.target === "Organization_slug_key") {
			return true;
		}
		// Support Prisma target metadata and the project's PostgreSQL adapter.
		const cause = meta?.driverAdapterError?.cause;
		const fields = Array.isArray(meta?.target) ? meta.target : cause?.kind === "UniqueConstraintViolation"
			? cause.constraint?.fields : undefined;
		return Array.isArray(fields) && fields.length === 1 && fields[0] === "slug";
	}
	private async runSerializable<T>(
		operation: (tx: Prisma.TransactionClient) => Promise<T>,
	): Promise<T> {
		for (let attempt = 1; ; attempt += 1) {
			try {
				return await this.prisma.$transaction(operation, {
					isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
				});
			} catch (error) {
				if (!this.isRetryableTransactionError(error)) {
					throw error;
				}
				if (attempt >= MAX_TRANSACTION_ATTEMPTS) {
					throw new ApiException(
						HttpStatus.CONFLICT,
						"CONCURRENT_MODIFICATION",
						"The organization was modified concurrently. Please retry.",
					);
				}
			}
		}
	}

	private isRetryableTransactionError(error: unknown): boolean {
		if (error instanceof Prisma.PrismaClientKnownRequestError) {
			return error.code === "P2034";
		}

		// Transaction completion can expose the driver error without a P2034 wrapper.
		if (
			typeof error !== "object" ||
			error === null ||
			!("name" in error) ||
			error.name !== "DriverAdapterError" ||
			!("cause" in error)
		) {
			return false;
		}
		const cause = error.cause;

		return (
			typeof cause === "object" &&
			cause !== null &&
			"kind" in cause &&
			cause.kind === "TransactionWriteConflict"
		);
	}
}
