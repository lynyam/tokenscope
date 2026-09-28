import { HttpStatus, Injectable } from "@nestjs/common";
import { MembershipRole, Prisma } from "../generated/prisma/client";
import { ApiException } from "../common/errors/api.exception";
import { PrismaService } from "../database/prisma.service";
import { UsersService } from "../users/users.service";
import type { AddMemberDto } from "./dto/add-member.dto";
import { OrganizationAccessService } from "./organization-access.service";
import { membershipSelect, toMembershipResponse } from "./membership.mapper";
import type {
	MembershipListResponse,
	MembershipRecord,
	MembershipResponse,
} from "./membership.mapper";
import type { UpdateMemberRoleDto } from "./dto/update-member-role.dto";

const MAX_TRANSACTION_ATTEMPTS = 3;

@Injectable()
export class MembershipsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly organizationAccess: OrganizationAccessService,
		private readonly users: UsersService,
	) { }

	async list(
		actorId: string,
		organizationId: string,
	): Promise<MembershipListResponse> {
		return this.prisma.$transaction(
			async (tx) => {
				const actor = await this.organizationAccess.assertOrganizationMember(
					actorId,
					organizationId,
					tx,
				);

				const memberships = await tx.membership.findMany({
					where: { organizationId },
					select: membershipSelect,
					orderBy: [{ createdAt: "asc" }, { id: "asc" }],
				});

				return {
					memberships: memberships.map(toMembershipResponse),
					currentUserRole: actor.role,
				};
			},
			{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
		);
	}

	async add(
		actorId: string,
		organizationId: string,
		dto: AddMemberDto,
	): Promise<MembershipResponse> {
		try {
			return await this.runSerializable(async (tx) => {
				await this.organizationAccess.assertOrganizationRole(
					actorId,
					organizationId,
					[MembershipRole.OWNER],
					tx,
				);

				const target = await this.users.findSafeByEmail(dto.email, tx);
				if (!target) {
					throw new ApiException(
						HttpStatus.NOT_FOUND,
						"USER_NOT_FOUND",
						"User not found.",
					);
				}

				const membership = await tx.membership.create({
					data: {
						organizationId,
						userId: target.id,
						role: dto.role,
					},
					select: membershipSelect,
				});

				return toMembershipResponse(membership);
			});
		} catch (error) {
			if (this.isMembershipConflict(error)) {
				throw new ApiException(
					HttpStatus.CONFLICT,
					"MEMBERSHIP_ALREADY_EXISTS",
					"This user is already a member of the organization.",
				);
			}
			throw error;
		}
	}

	async updateRole(
		actorId: string,
		organizationId: string,
		targetUserId: string,
		dto: UpdateMemberRoleDto,
	): Promise<MembershipResponse> {
		return this.runSerializable(async (tx) => {
			await this.organizationAccess.assertOrganizationRole(
				actorId,
				organizationId,
				[MembershipRole.OWNER],
				tx,
			);
			const target = await this.findMembership(
				organizationId,
				targetUserId,
				tx,
			);
			// An unchanged role is a successful no-op, including for the sole owner.
			if (target.role === dto.role) {
				return toMembershipResponse(target);
			}
			if (target.role === MembershipRole.OWNER) {
				await this.assertAnotherOwner(organizationId, tx);
			}
			const updated = await tx.membership.update({
				where: {
					organizationId_userId: {
						organizationId,
						userId: targetUserId,
					},
				},
				data: { role: dto.role },
				select: membershipSelect,
			});
			return toMembershipResponse(updated);
		});
	}
	async remove(
		actorId: string,
		organizationId: string,
		targetUserId: string,
	): Promise<void> {
		await this.runSerializable(async (tx) => {
			await this.organizationAccess.assertOrganizationRole(
				actorId,
				organizationId,
				[MembershipRole.OWNER],
				tx,
			);
			const target = await this.findMembership(
				organizationId,
				targetUserId,
				tx,
			);

			if (target.role === MembershipRole.OWNER) {
				await this.assertAnotherOwner(organizationId, tx);
			}

			await tx.membership.delete({
				where: {
					organizationId_userId: {
						organizationId,
						userId: targetUserId,
					},
				},
			});
		});
	}

	private async findMembership(
		organizationId: string,
		targetUserId: string,
		tx: Prisma.TransactionClient,
	): Promise<MembershipRecord> {
		const membership = await tx.membership.findUnique({
			where: {
				organizationId_userId: {
					organizationId,
					userId: targetUserId,
				},
			},
			select: membershipSelect,
		});

		if (!membership) {
			throw new ApiException(
				HttpStatus.NOT_FOUND,
				"MEMBERSHIP_NOT_FOUND",
				"Membership not found.",
			);
		}

		return membership;
	}

	private async assertAnotherOwner(
		organizationId: string,
		tx: Prisma.TransactionClient,
	): Promise<void> {
		const owners = await tx.membership.count({
			where: {
				organizationId,
				role: MembershipRole.OWNER,
			},
		});

		if (owners < 2) {
			throw new ApiException(
				HttpStatus.CONFLICT,
				"LAST_OWNER_REQUIRED",
				"An organization must retain at least one owner.",
			);
		}
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
				const retryable =this.isRetryableTransactionError(error);

				if (!retryable || attempt >= MAX_TRANSACTION_ATTEMPTS) {
					throw error;
				}
			}
		}
	}

	private isRetryableTransactionError(error: unknown): boolean {
		if (error instanceof Prisma.PrismaClientKnownRequestError) {
			return error.code === "P2034";
		}

		// Transaction completion can expose the driver error
		// without a P2034 wrapper.
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

	private isMembershipConflict(error: unknown): boolean {
		if (
			!(error instanceof Prisma.PrismaClientKnownRequestError) ||
			error.code !== "P2002"
		) {
			return false;
		}

		const meta = error.meta as {
			modelName?: string;
			target?: unknown;
			driverAdapterError?: {
				cause?: { kind?: string; constraint?: { fields?: unknown } };
			};
		} | undefined;

		if (meta?.modelName && meta.modelName !== "Membership") return false;
		if (meta?.target === "Membership_organizationId_userId_key") return true;

		const cause = meta?.driverAdapterError?.cause;
		const fields = Array.isArray(meta?.target)
			? meta.target
			: cause?.kind === "UniqueConstraintViolation"
				? cause.constraint?.fields
				: undefined;

		if (!Array.isArray(fields)) return false;

		const names = fields.map((field) =>
			typeof field === "string" ? field.replace(/^"(.*)"$/, "$1") : field,
		);

		return (
			names.length === 2 &&
			names.includes("organizationId") &&
			names.includes("userId")
		);
	}
}
