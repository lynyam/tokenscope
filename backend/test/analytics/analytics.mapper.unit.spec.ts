import { mapAnalytics } from "../../src/analytics/analytics.mapper";
import { parseAnalyticsQuery } from "../../src/analytics/dto/analytics-query.dto";
import type { SummaryRow } from "../../src/analytics/analytics.types";

const empty: SummaryRow = {
	traceCount: "0",
	inputTokens: "0",
	outputTokens: "0",
	totalTokens: "0",
	estimatedCostUsd: "0",
	errorCount: "0",
	errorRatePct: null,
	averageLatencyMs: null,
	containsSyntheticPricing: false,
};

const query = parseAnalyticsQuery({
	from: "2026-10-01T10:30:00Z",
	to: "2026-10-01T12:15:00Z",
});

describe("Analytics response mapping", () => {
	it("zero-fills partial UTC buckets and keeps absent observations null", () => {
		const result = mapAnalytics(
			"project", query, empty, [], [],
		);

		expect(result.series.map(row => row.bucketStart)).toEqual([
			"2026-10-01T10:00:00.000Z",
			"2026-10-01T11:00:00.000Z",
			"2026-10-01T12:00:00.000Z",
		]);

		expect(result.summary).toEqual({
			traceCount: 0,
			inputTokens: "0",
			outputTokens: "0",
			totalTokens: "0",
			estimatedCostUsd: "0.000000000000",
			errorCount: 0,
			errorRatePct: null,
			averageLatencyMs: null,
		});

		expect(result.filters).toEqual({
			q: null,
			provider: null,
			model: null,
			workflow: null,
			status: null,
		});

		expect(result.byModel).toEqual([]);
		expect(result).not.toHaveProperty("pricing");
		expect(result).not.toHaveProperty("containsSyntheticPricing");
	});

	it("preserves values beyond JS safe integers and all cost digits", () => {
		const row: SummaryRow = {
			...empty,
			traceCount: "1",
			inputTokens: "9007199254740993",
			outputTokens: "7",
			totalTokens: "9007199254741000",
			estimatedCostUsd: "1234567890123.123456789012",
			averageLatencyMs: "0.000",
			errorRatePct: "0.00",
		};

		const result = mapAnalytics("project", query, row, [], []);

		expect(result.summary.inputTokens).toBe("9007199254740993");
		expect(result.summary.totalTokens).toBe("9007199254741000");
		expect(result.summary.estimatedCostUsd)
			.toBe("1234567890123.123456789012");
		expect(result.summary.averageLatencyMs).toBe(0);

		expect(() => JSON.stringify(result)).not.toThrow();
	});

	it("refuses unsafe JSON counts instead of losing precision", () => {
		expect(() => mapAnalytics(
			"project",
			query,
			{ ...empty, traceCount: "9007199254740992" },
			[],
			[],
		)).toThrow();
	});

	it("places non-empty buckets correctly and preserves database model ordering", () => {
		const totals = {
			traceCount: "1",
			inputTokens: "1",
			outputTokens: "0",
			estimatedCostUsd: "0.01",
		};

		const models = [
			{ ...totals, provider: "a", model: "x" },
			{ ...totals, provider: "b", model: "x" },
		];

		const result = mapAnalytics(
			"project",
			query,
			{ ...empty, ...totals, totalTokens: "1" },
			[{
				...totals,
				bucketStart: "2026-10-01T11:00:00.000Z",
			}],
			models,
		);

		expect(result.series.map(row => row.traceCount))
			.toEqual([0, 1, 0]);
		expect(result.byModel.map(row => row.provider))
			.toEqual(["a", "b"]);
		expect(result.series[1].estimatedCostUsd)
			.toBe("0.010000000000");
	});
});
