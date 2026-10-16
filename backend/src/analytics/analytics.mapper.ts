import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client";

import {
	bucketStart,
	bucketWidth,
} from "./dto/analytics-query.dto";

import type {
	AggregateRow,
	AnalyticsSnapshot,
	AnalyticsTotals,
	ModelRow,
	ResolvedAnalyticsQuery,
	SeriesRow,
	SummaryRow,
} from "./analytics.types";

function integer(value: string): string {
	if (!/^\d+$/.test(value)) {
		throw new Error("Invalid analytics integer");
	}

	return BigInt(value).toString();
}

function count(value: string): number {
	const exact = BigInt(integer(value));

	if (exact > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error(
			"Analytics count exceeds JSON safe integer range",
		);
	}

	return Number(exact);
}

function nullableNumber(
	value: string | null,
): number | null {
	if (value === null) return null;

	const result = Number(value);

	if (!Number.isFinite(result)) {
		throw new Error("Invalid analytics measurement");
	}

	return result;
}

function mapTotals(row: AggregateRow): AnalyticsTotals {
	const cost = new Prisma.Decimal(row.estimatedCostUsd);

	if (!cost.isFinite() || cost.isNegative()) {
		throw new Error("Invalid analytics cost");
	}

	return {
		traceCount: count(row.traceCount),
		inputTokens: integer(row.inputTokens),
		outputTokens: integer(row.outputTokens),
		estimatedCostUsd: cost.toFixed(12),
	};
}

export function mapAnalytics(
	projectId: string,
	query: ResolvedAnalyticsQuery,
	summary: SummaryRow,
	series: SeriesRow[],
	models: ModelRow[],
): AnalyticsSnapshot {
	const { filters, bucket } = query;

	const byBucket = new Map(
		series.map(row => [row.bucketStart, row]),
	);

	const filled: AnalyticsSnapshot["series"] = [];

	for (
		let ms = bucketStart(filters.from, bucket);
		ms < filters.to.getTime();
		ms += bucketWidth(bucket)
	) {
		const start = new Date(ms).toISOString();
		const row = byBucket.get(start);

		filled.push({
			bucketStart: start,

			...(row
				? mapTotals(row)
				: {
					traceCount: 0,
					inputTokens: "0",
					outputTokens: "0",
					estimatedCostUsd: "0.000000000000",
				}),
		});
	}

	return {
		snapshotId: randomUUID(),
		generatedAt: new Date().toISOString(),
		projectId,

		window: {
			from: filters.from.toISOString(),
			to: filters.to.toISOString(),
			timezone: "UTC",
			bucket,
		},

		filters: {
			q: filters.q ?? null,
			provider: filters.provider ?? null,
			model: filters.model ?? null,
			workflow: filters.workflow ?? null,
			status: filters.status ?? null,
		},

		summary: {
			...mapTotals(summary),
			totalTokens: integer(summary.totalTokens),
			errorCount: count(summary.errorCount),
			errorRatePct: nullableNumber(summary.errorRatePct),
			averageLatencyMs: nullableNumber(summary.averageLatencyMs),
		},

		series: filled,

		// SQL already establishes the contract's numeric ordering.
		byModel: models.map(row => ({
			provider: row.provider,
			model: row.model,
			...mapTotals(row),
		})),
	};
}
