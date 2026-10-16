import type { ResolvedTraceFilters } from "../traces/trace-filters";

export type AnalyticsBucket = "hour" | "day";

export interface ResolvedAnalyticsQuery {
	filters: ResolvedTraceFilters;
	bucket: AnalyticsBucket;
}

export interface AnalyticsScope {
	actorId: string;
	organizationId: string;
	projectId: string;
}

export interface AnalyticsTotals {
	traceCount: number;
	inputTokens: string;
	outputTokens: string;
	estimatedCostUsd: string;
}

export interface AnalyticsSnapshot {
	snapshotId: string;
	generatedAt: string;
	projectId: string;

	window: {
		from: string;
		to: string;
		timezone: "UTC";
		bucket: AnalyticsBucket;
	};

	filters: {
		q: string | null;
		provider: string | null;
		model: string | null;
		workflow: string | null;
		status: "SUCCESS" | "ERROR" | null;
	};

	summary: AnalyticsTotals & {
		totalTokens: string;
		errorCount: number;
		errorRatePct: number | null;
		averageLatencyMs: number | null;
	};

	series: Array<AnalyticsTotals & {
		bucketStart: string;
	}>;

	byModel: Array<AnalyticsTotals & {
		provider: string;
		model: string;
	}>;
}

export interface AnalyticsReadResult {
	snapshot: AnalyticsSnapshot;

	project: {
		id: string;
		name: string;
		description: string | null;
	};

	pricing: {
		currency: "USD";
		containsSyntheticPricing: boolean;
	};
}

// SQL casts exact aggregates to text.
// No driver/JavaScript number conversion intervenes.
export interface AggregateRow {
	traceCount: string;
	inputTokens: string;
	outputTokens: string;
	estimatedCostUsd: string;
}

export interface SummaryRow extends AggregateRow {
	totalTokens: string;
	errorCount: string;
	errorRatePct: string | null;
	averageLatencyMs: string | null;
	containsSyntheticPricing: boolean;
}

export interface SeriesRow extends AggregateRow {
	bucketStart: string;
}

export interface ModelRow extends AggregateRow {
	provider: string;
	model: string;
}
