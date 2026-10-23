import { Injectable } from "@nestjs/common";
import { Prisma, MembershipRole } from "../generated/prisma/client";
import { PrismaService } from "../database/prisma.service";
import { ApiException } from "../common/errors/api.exception";
import { ApiKeyAuthService } from "../api-keys/api-key-auth.service";
import type { ApiKeyPrincipal } from "../api-keys/api-key.types";
import { ProjectAccessService } from "../projects/project-access.service";
import {
	mapTrace,
	traceResponseInclude,
} from "./trace.mapper";
import { traceMatchingWhere } from "./trace-filters";
import {
	traceOrderBy,
	type TraceListQuery,
} from "./dto/trace-query.dto";
import {
	browserTraceScope,
	publicTraceScope,
} from "./trace-scope";

const READ_ROLES = [
	MembershipRole.OWNER,
	MembershipRole.ADMIN,
	MembershipRole.MEMBER,
];

@Injectable()
export class TraceReadsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly apiKeys: ApiKeyAuthService,
		private readonly projects: ProjectAccessService,
	) { }

	listPublic(principal: ApiKeyPrincipal, query: TraceListQuery) {
		return this.snapshot(async tx => {
			await this.apiKeys.assertActivePrincipal(principal, tx);

			return this.page(tx, publicTraceScope(principal), query);
		});
	}

	detailPublic(principal: ApiKeyPrincipal, traceId: string) {
		return this.snapshot(async tx => {
			await this.apiKeys.assertActivePrincipal(principal, tx);

			return this.detail(tx, publicTraceScope(principal), traceId);
		});
	}

	listBrowser(
		actorId: string,
		organizationId: string,
		projectId: string,
		query: TraceListQuery,
	) {
		return this.snapshot(async tx => {
			await this.projects.assertProjectAccess(
				actorId,
				organizationId,
				projectId,
				READ_ROLES,
				tx,
			);

			return this.page(
				tx,
				browserTraceScope(actorId, organizationId, projectId),
				query,
			);
		});
	}

	detailBrowser(
		actorId: string,
		organizationId: string,
		projectId: string,
		traceId: string,
	) {
		return this.snapshot(async tx => {
			await this.projects.assertProjectAccess(
				actorId,
				organizationId,
				projectId,
				READ_ROLES,
				tx,
			);

			return this.detail(
				tx,
				browserTraceScope(actorId, organizationId, projectId),
				traceId,
			);
		});
	}

	private snapshot<T>(
		work: (tx: Prisma.TransactionClient) => Promise<T>,
	): Promise<T> {
		return this.prisma.$transaction(work, {
			isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
			maxWait: 5000,
			timeout: 10_000,
		});
	}

	private async page(
		tx: Prisma.TransactionClient,
		scope: Prisma.TraceWhereInput,
		query: TraceListQuery,
	) {
		const where: Prisma.TraceWhereInput = {
			AND: [scope, traceMatchingWhere(query.filters)],
		};

		// Authorization, count and rows share one database snapshot.
		const total = await tx.trace.count({ where });

		const rows = await tx.trace.findMany({
			where,
			orderBy: traceOrderBy(query),
			skip: query.skip,
			take: query.pageSize,
			include: traceResponseInclude,
		});

		return {
			items: rows.map(mapTrace),
			page: query.page,
			pageSize: query.pageSize,
			total,
			totalPages: Math.ceil(total / query.pageSize),
		};
	}

	private async detail(
		tx: Prisma.TransactionClient,
		scope: Prisma.TraceWhereInput,
		traceId: string,
	) {
		// Detail deliberately has no seven-day date restriction.
		const row = await tx.trace.findFirst({
			where: { AND: [scope, { id: traceId }] },
			include: traceResponseInclude,
		});

		if (!row) {
			throw new ApiException(404, "TRACE_NOT_FOUND", "Trace not found.");
		}

		return mapTrace(row);
	}
}