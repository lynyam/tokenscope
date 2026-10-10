import { HttpStatus, Injectable } from "@nestjs/common";
import {
  MembershipRole,
  Prisma,
} from "../generated/prisma/client";
import { PrismaService } from "../database/prisma.service";
import { ProjectAccessService } from "../projects/project-access.service";
import { ApiException } from "../common/errors/api.exception";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";
import {
  API_KEY_SUMMARY_SELECT,
  toApiKeySummary,
} from "./api-key.mapper";
import { generateApiKeySecret } from "./api-key-secret";
import type {
  ApiKeySummary,
  CreatedApiKey,
} from "./api-key.types";

const MANAGEMENT_ROLES = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
] as const;

const MAX_TRANSACTION_ATTEMPTS = 3;

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async create(
    actorId: string,
    organizationId: string,
    projectId: string,
    dto: CreateApiKeyDto,
  ): Promise<CreatedApiKey> {
    // Keep this secret only in memory until the transaction commits.
    const secret = generateApiKeySecret();

    const row = await this.runSerializable(async tx => {
      await this.projectAccess.assertProjectAccess(
        actorId,
        organizationId,
        projectId,
        MANAGEMENT_ROLES,
        tx,
      );

      return tx.apiKey.create({
        data: {
          projectId,
          name: dto.name,
          createdByUserId: actorId,
          keyHash: secret.keyHash,
          keyPrefix: secret.keyPrefix,
        },
        select: API_KEY_SUMMARY_SELECT,
      });
    });

    // $transaction has committed before plaintext reaches the caller.
    return {
      ...toApiKeySummary(row),
      key: secret.key,
    };
  }

  async list(
    actorId: string,
    organizationId: string,
    projectId: string,
  ): Promise<ApiKeySummary[]> {
    // Authorization and rows come from one consistent database snapshot.
    const rows = await this.prisma.$transaction(
      async tx => {
        await this.projectAccess.assertProjectAccess(
          actorId,
          organizationId,
          projectId,
          MANAGEMENT_ROLES,
          tx,
        );

        return tx.apiKey.findMany({
          where: { projectId },
          select: API_KEY_SUMMARY_SELECT,
          orderBy: [
            { createdAt: "desc" },
            { id: "asc" },
          ],
        });
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );

    return rows.map(toApiKeySummary);
  }

  async revoke(
    actorId: string,
    organizationId: string,
    projectId: string,
    apiKeyId: string,
  ): Promise<void> {
    await this.runSerializable(async tx => {
      // Recheck current authorization even for an already revoked key.
      await this.projectAccess.assertProjectAccess(
        actorId,
        organizationId,
        projectId,
        MANAGEMENT_ROLES,
        tx,
      );

      const key = await tx.apiKey.findFirst({
        where: {
          id: apiKeyId,
          projectId,
        },
        select: {
          id: true,
          revokedAt: true,
        },
      });

      if (!key) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          "API_KEY_NOT_FOUND",
          "API key not found.",
        );
      }

      if (key.revokedAt !== null) {
        return;
      }

      // The existing timestamp must survive repeated revocation.
      await tx.apiKey.updateMany({
        where: {
          id: apiKeyId,
          projectId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    });
  }

  private async runSerializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (!this.isTransactionConflict(error)) {
          throw error;
        }

        if (attempt >= MAX_TRANSACTION_ATTEMPTS) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "CONCURRENT_MODIFICATION",
            "The resource changed concurrently. Please try again.",
          );
        }

        // The entire callback runs again, including authorization.
      }
    }
  }

  private isTransactionConflict(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return error.code === "P2034";
    }

    // Match the adapter form already handled by ProjectsService.
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

    return typeof cause === "object" &&
      cause !== null &&
      "kind" in cause &&
      cause.kind === "TransactionWriteConflict";
  }
}
