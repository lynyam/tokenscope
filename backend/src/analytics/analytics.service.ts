import { Injectable } from "@nestjs/common";

import {
	MembershipRole,
	Prisma,
} from "../generated/prisma/client";

import { PrismaService } from "../database/prisma.service";
import { ProjectAccessService } from "../projects/project-access.service";

import { traceMatchingSql } from "../traces/trace-filters";
import { browserTraceScopeSql } from "../traces/trace-scope";

import {
	readModels,
	readSeries,
	readSummary,
} from "./analytics.queries";

import { mapAnalytics } from "./analytics.mapper";

import type {
	AnalyticsReadResult,
	AnalyticsScope,
	AnalyticsSnapshot,
	ResolvedAnalyticsQuery,
} from "./analytics.types";

const READ_ROLES = [
	MembershipRole.OWNER,
	MembershipRole.ADMIN,
	MembershipRole.MEMBER,
];

@Injectable()
export class AnalyticsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly projects: ProjectAccessService,
	) { }

	getSnapshot(
		scope: AnalyticsScope,
		query: ResolvedAnalyticsQuery,
	): Promise<AnalyticsSnapshot> {
		return this.prisma.$transaction(
			async tx => {
				const result = await this.readSnapshotInTransaction(
					tx,
					scope,
					query,
				);

				return result.snapshot;
			},
			{
				isolationLevel:
					Prisma.TransactionIsolationLevel.RepeatableRead,
				maxWait: 5000,
				timeout: 10_000,
			},
		);
	}

	// Caller owns a short Repeatable Read transaction.
	// Every database read uses tx.
	//
	// This entry point authorizes independently and never opens
	// a nested transaction.
	async readSnapshotInTransaction(
		tx: Prisma.TransactionClient,
		scope: AnalyticsScope,
		query: ResolvedAnalyticsQuery,
	): Promise<AnalyticsReadResult> {
		const project = await this.projects.assertProjectAccess(
			scope.actorId,
			scope.organizationId,
			scope.projectId,
			READ_ROLES,
			tx,
		);

		const where = Prisma.sql`
			(
				${browserTraceScopeSql(
					scope.actorId,
					scope.organizationId,
					scope.projectId,
				)}
			)
			AND (${traceMatchingSql(query.filters)})
		`;

		const summary = await readSummary(tx, where);
		const series = await readSeries(tx, where, query.bucket);
		const models = await readModels(tx, where);

		return {
			snapshot: mapAnalytics(
				scope.projectId,
				query,
				summary,
				series,
				models,
			),

			project: {
				id: project.id,
				name: project.name,
				description: project.description,
			},

			pricing: {
				currency: "USD",
				containsSyntheticPricing:
					summary.containsSyntheticPricing,
			},
		};
	}
}
