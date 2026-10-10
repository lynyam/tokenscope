import {
	HttpStatus,
	Injectable,
	Logger,
  } from "@nestjs/common";
  import type { Prisma } from "../generated/prisma/client";
  import { PrismaService } from "../database/prisma.service";
  import { ApiException } from "../common/errors/api.exception";
  import {
	hashApiKey,
	hasValidApiKeyFormat,
  } from "./api-key-secret";
  import type { ApiKeyPrincipal } from "./api-key.types";

  @Injectable()
  export class ApiKeyAuthService {
	private readonly logger = new Logger(ApiKeyAuthService.name);

	constructor(private readonly prisma: PrismaService) {}

	async authenticate(key: string): Promise<ApiKeyPrincipal> {
	  if (!hasValidApiKeyFormat(key)) {
		throw this.invalidKey();
	  }

	  const row = await this.prisma.apiKey.findFirst({
		where: {
		  keyHash: hashApiKey(key),
		  revokedAt: null,
		  project: {
			archivedAt: null,
			organization: {
			  archivedAt: null,
			},
		  },
		},
		select: {
		  id: true,
		  projectId: true,
		},
	  });

	  if (!row) {
		throw this.invalidKey();
	  }

	  // Never catch database read errors and disguise them as invalid keys.

	  return Object.freeze({
		keyId: row.id,
		projectId: row.projectId,
	  });
	}

	async assertActivePrincipal(
	  principal: ApiKeyPrincipal,
	  tx: Prisma.TransactionClient = this.prisma,
	): Promise<void> {
	  const key = await tx.apiKey.findFirst({
		where: {
		  id: principal.keyId,
		  projectId: principal.projectId,
		  revokedAt: null,
		  project: {
			archivedAt: null,
			organization: {
			  archivedAt: null,
			},
		  },
		},
		select: {
		  id: true,
		},
	  });

	  if (!key) {
		throw this.invalidKey();
	  }
	}

	async recordSuccessfulUse(
	  principal: ApiKeyPrincipal,
	): Promise<void> {
	  const now = new Date();
	  const threshold = new Date(now.getTime() - 60_000);

	  try {
		// One persisted update per key per minute, including concurrent use.
		// This is metadata about authentication, not trace-operation success.
		await this.prisma.apiKey.updateMany({
		  where: {
			id: principal.keyId,
			projectId: principal.projectId,
			revokedAt: null,
			project: {
			  archivedAt: null,
			  organization: {
				archivedAt: null,
			  },
			},
			OR: [
			  { lastUsedAt: null },
			  { lastUsedAt: { lte: threshold } },
			],
		  },
		  data: {
			lastUsedAt: now,
		  },
		});
	  } catch {
		// Metadata failure must not turn a valid operation into a failure.
		// Never log the exception: it could contain query arguments.
		this.logger.warn(JSON.stringify({
		  event: "api_key_last_used_update_failed",
		}));
	  }
	}

	private invalidKey(): ApiException {
	  return new ApiException(
		HttpStatus.UNAUTHORIZED,
		"INVALID_API_KEY",
		"The provided API key is invalid.",
	  );
	}
  }

  //later trace will call:
  //await this.apiKeyAuth.assertActivePrincipal(principal, tx);
