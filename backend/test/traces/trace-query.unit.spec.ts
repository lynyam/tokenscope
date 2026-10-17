import {
	escapeTraceSearch,
	resolveTraceFilters,
	traceMatchingWhere,
} from "../../src/traces/trace-filters";
import {
	parseTraceListQuery,
	traceOrderBy,
} from "../../src/traces/dto/trace-query.dto";
import {
	parseTraceVersion,
	assertTraceVersion,
} from "../../src/traces/trace-version";

const dates = {
	from: "2026-10-01T00:00:00Z",
	to: "2026-10-02T00:00:00Z",
};

describe("Trace filter and list validation", () => {
	it("resolves the default window from one supplied instant", () => {
		const now = new Date("2026-10-13T12:00:00Z");
		const result = resolveTraceFilters({}, now);

		expect(result.to.toISOString()).toBe("2026-10-13T12:00:00.000Z");
		expect(result.from.toISOString()).toBe("2026-10-06T12:00:00.000Z");
	});

	it.each([
		{ from: dates.from },
		{ ...dates, to: dates.from },
		{ from: "2026-02-30T00:00:00Z", to: dates.to },
		{ from: "2026-01-01T00:00:00Z", to: dates.to },
		{ ...dates, provider: ["fixture-a", "fixture-b"] },
		{ ...dates, status: "success" },
		{ ...dates, includeDeleted: "true" },
		{ ...dates, workflow: "   " },
		{ ...dates, q: "x".repeat(101) },
	])("rejects invalid filters: %j", input => {
		expect(() => resolveTraceFilters(input)).toThrow();
	});

	it("normalizes identifiers and preserves workflow case", () => {
		const result = resolveTraceFilters({
			...dates,
			provider: " FIXTURE-A ",
			model: " DEMO-FAST ",
			workflow: " Support ",
			q: " ",
		});

		expect(result.provider).toBe("fixture-a");
		expect(result.model).toBe("demo-fast");
		expect(result.workflow).toBe("Support");
		expect(result.q).toBeUndefined();
	});

	it("uses inclusive/exclusive boundaries and literal search", () => {
		const filters = resolveTraceFilters({ ...dates, q: "a%_\\b" });
		const where = traceMatchingWhere(filters);

		expect(escapeTraceSearch("a%_\\b")).toBe("a\\%\\_\\\\b");
		expect(where.occurredAt).toEqual({
			gte: filters.from,
			lt: filters.to,
		});
		expect(where.deletedAt).toBeNull();
		expect(where.OR).toHaveLength(3);
	});

	it.each([
		{ page: "1.5" },
		{ page: "1e2" },
		{ page: "2abc" },
		{ page: "0" },
		{ page: ["1", "2"] },
		{ page: String(Number.MAX_SAFE_INTEGER), pageSize: "100" },
		{ pageSize: "101" },
		{ sortBy: "metadata" },
		{ sortOrder: "sideways" },
		{ unknown: "value" },
	])("rejects unsafe list parameters: %j", patch => {
		expect(() => parseTraceListQuery({ ...dates, ...patch })).toThrow();
	});

	it("adds a deterministic tie-breaker", () => {
		const query = parseTraceListQuery({
			...dates,
			page: "2",
			pageSize: "25",
			sortBy: "estimatedCostUsd",
			sortOrder: "asc",
		});

		expect(query.skip).toBe(25);
		expect(traceOrderBy(query)).toEqual([
			{ estimatedCostUsd: "asc" },
			{ id: "asc" },
		]);
	});

	it("does not accept pagination in shared filters", () => {
		expect(() => resolveTraceFilters({ ...dates, page: "1" })).toThrow();
	});
});

describe("Trace versions", () => {
	it("accepts one quoted positive integer", () => {
		expect(parseTraceVersion('"12"')).toBe(12);
	});

	it.each([
		"1",
		'"0"',
		'"-1"',
		'"01"',
		'W/"1"',
		"*",
		'"1", "2"',
		'"1.5"',
		'"2147483648"',
	])("rejects %s", value => {
		expect(() => parseTraceVersion(value)).toThrow();
	});

	it("distinguishes missing and stale preconditions", () => {
		expect(() => parseTraceVersion(undefined)).toThrow(
			expect.objectContaining({ code: "TRACE_VERSION_REQUIRED" }),
		);

		expect(() => assertTraceVersion(2, 1)).toThrow(
			expect.objectContaining({ code: "TRACE_VERSION_CONFLICT" }),
		);
	});
});