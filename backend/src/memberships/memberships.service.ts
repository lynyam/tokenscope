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
  MembershipResponse,
} from "./membership.mapper";

const MAX_TRANSACTION_ATTEMPTS = 3;

@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly users: UsersService,
  ) {}

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

  private async runSerializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034";

        if (!retryable || attempt >= MAX_TRANSACTION_ATTEMPTS) {
          throw error;
        }
      }
    }
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
