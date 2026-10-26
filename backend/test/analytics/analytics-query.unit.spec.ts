import {
	parseAnalyticsQuery,
} from "../../src/analytics/dto/analytics-query.dto";

const day = {
	from: "2026-10-01T00:00:00.000Z",
	to: "2026-10-02T00:00:00.000Z",
};

describe("Analytics query", () => {
	it("resolves one explicit seven-day window and daily buckets", () => {
		const now = new Date("2026-10-16T00:00:00.000Z");
		const result = parseAnalyticsQuery({}, now);

		expect(result.filters.from.toISOString())
			.toBe("2026-10-09T00:00:00.000Z");
		expect(result.filters.to.toISOString())
			.toBe(now.toISOString());
		expect(result.bucket).toBe("day");

		expect(() => parseAnalyticsQuery({}, now, true)).toThrow();
	});

	it("reuses shared normalization and preserves workflow case", () => {
		const result = parseAnalyticsQuery({
			...day,
			q: " SUPPORT ",
			provider: " FIXTURE-A ",
			model: " DEMO-FAST ",
			workflow: " Support ",
			status: "ERROR",
		});

		expect(result.filters).toMatchObject({
			q: "SUPPORT",
			provider: "fixture-a",
			model: "demo-fast",
			workflow: "Support",
			status: "ERROR",
		});

		expect(result.bucket).toBe("hour");

		expect(
			parseAnalyticsQuery({ ...day, q: "   " }).filters.q,
		).toBeUndefined();
	});

	it.each([
		{ from: day.from },
		{ to: day.to },
		{ ...day, from: day.to },
		{ ...day, from: "2026-02-30T00:00:00Z" },
		{ ...day, from: "2026-10-01T00:00:00+00:00" },
		{ ...day, to: "2027-02-01T00:00:00Z" },
		{ ...day, page: "1" },
		{ ...day, sortBy: "occurredAt" },
		{ ...day, actorId: "actor" },
		{ ...day, includeArchived: "true" },
		{ ...day, bucket: "week" },
		{ ...day, bucket: ["hour", "day"] },
		{ ...day, provider: ["fixture-a"] },
		{ ...day, from: [day.from] },
	])("rejects invalid selection %j", input => {
		expect(() => parseAnalyticsQuery(input)).toThrow();
	});

	it("uses hourly through exactly 48 hours and honors explicit day", () => {
		expect(parseAnalyticsQuery({
			...day,
			to: "2026-10-03T00:00:00Z",
		}).bucket).toBe("hour");

		expect(parseAnalyticsQuery({
			...day,
			to: "2026-10-03T00:00:00.001Z",
		}).bucket).toBe("day");

		expect(parseAnalyticsQuery({
			...day,
			bucket: "day",
		}).bucket).toBe("day");
	});

	it("rejects 2161 intersecting hours even when duration is only 90 days", () => {
		expect(() => parseAnalyticsQuery({
			from: "2026-01-01T00:00:00Z",
			to: "2026-04-01T00:00:00Z",
			bucket: "hour",
		})).not.toThrow();

		const unaligned = {
			from: "2026-01-01T00:30:00Z",
			to: "2026-04-01T00:30:00Z",
		};

		expect(() => parseAnalyticsQuery({
			...unaligned,
			bucket: "hour",
		})).toThrow();

		expect(parseAnalyticsQuery(unaligned).bucket).toBe("day");
	});
});
