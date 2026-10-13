import {
	hashTracePayload,
	normalizeTracePayload,
} from "../../src/traces/trace-payload";

const now = new Date("2026-10-10T12:00:00.000Z");

const valid = {
	externalId: "request-1",
	provider: "fixture-a",
	model: "demo-fast",
	workflow: "support",
	inputTokens: 1000,
	outputTokens: 200,
	latencyMs: 0,
	status: "SUCCESS",
	occurredAt: "2026-10-01T10:00:00Z",
};

describe("Trace payload", () => {
	it("normalizes without mutating the caller", () => {
		const input = {
			...valid,
			externalId: " Request-1 ",
			provider: " FIXTURE-A ",
			model: " DEMO-FAST ",
			workflow: " Support ",
		};

		const result = normalizeTracePayload(input, now);

		expect(result).toMatchObject({
			externalId: "Request-1",
			provider: "fixture-a",
			model: "demo-fast",
			workflow: "Support",
			occurredAt: "2026-10-01T10:00:00.000Z",
			metadata: {},
		});

		expect(input.provider).toBe(" FIXTURE-A ");
	});

	it("hashes equivalent timestamps/defaults/metadata order identically", () => {
		const first = normalizeTracePayload({
			...valid,
			metadata: { b: true, a: 1 },
		}, now);

		const second = normalizeTracePayload({
			...valid,
			provider: " FIXTURE-A ",
			occurredAt: "2026-10-01T10:00:00.000Z",
			metadata: { a: 1, b: true },
		}, now);

		expect(hashTracePayload(first)).toBe(hashTracePayload(second));

		expect(hashTracePayload(normalizeTracePayload(valid, now)))
			.toBe(hashTracePayload(normalizeTracePayload({
				...valid,
				metadata: {},
			}, now)));
	});

	it("keeps meaningful differences", () => {
		const base = normalizeTracePayload(valid, now);

		for (const patch of [
			{ externalId: "REQUEST-1" },
			{ workflow: "Support" },
			{ inputTokens: 1001 },
			{ metadata: { changed: true } },
		]) {
			expect(hashTracePayload(normalizeTracePayload({
				...valid,
				...patch,
			}, now))).not.toBe(hashTracePayload(base));
		}
	});

	it.each([
		{ inputTokens: "1000" },
		{ inputTokens: 1.1 },
		{ inputTokens: -1 },
		{ inputTokens: 1_000_000_001 },
		{ outputTokens: null },
		{ latencyMs: 86_400_001 },
		{ status: "success" },
		{ workflow: "   " },
		{ workflow: "line\nbreak" },
		{ occurredAt: "2026-02-30T10:00:00Z" },
		{ occurredAt: "2026-10-01T10:00:00+00:00" },
		{ occurredAt: "2026-10-01T10:00:00.0001Z" },
		{ occurredAt: "2026-10-10T12:05:00.001Z" },
		{ metadata: null },
		{ metadata: [] },
		{ metadata: { nested: {} } },
		{ metadata: { nested: [] } },
		{ metadata: { number: Infinity } },
		{ metadata: { value: "a".repeat(401) } },
		{ metadata: { ["a".repeat(65)]: true } },
		{ metadata: { value: "\u0000" } },
		{ metadata: { value: "\ud800" } },
		{
			metadata: Object.fromEntries(
				Array.from({ length: 21 }, (_, i) => [`k${i}`, true]),
			)
		},
		{ projectId: "client-controlled" },
		{ estimatedCostUsd: "0" },
		{ prompt: "must not be stored" },
	])("rejects invalid data: %j", patch => {
		expect(() => normalizeTracePayload({
			...valid,
			...patch,
		}, now)).toThrow();
	});

	it("enforces metadata bytes, not just string length", () => {
		const metadata = Object.fromEntries(
			Array.from({ length: 5 }, (_, i) => [
				`k${i}`,
				"界".repeat(400),
			]),
		);

		expect(() => normalizeTracePayload({
			...valid,
			metadata,
		}, now)).toThrow();
	});

	it("accepts exact upper counters and future boundary", () => {
		expect(normalizeTracePayload({
			...valid,
			inputTokens: 1_000_000_000,
			outputTokens: 1_000_000_000,
			latencyMs: 86_400_000,
			occurredAt: "2026-10-10T12:05:00Z",
		}, now)).toMatchObject({
			inputTokens: 1_000_000_000,
			occurredAt: "2026-10-10T12:05:00.000Z",
		});
	});

	it("preserves arbitrary metadata keys without prototype mutation", () => {
		const metadata = JSON.parse(
			'{"__proto__":"retained","constructor":"retained"}',
		);

		const result = normalizeTracePayload({
			...valid,
			metadata,
		}, now);

		expect(Object.keys(result.metadata)).toEqual([
			"__proto__",
			"constructor",
		]);
		expect(Object.getPrototypeOf(result.metadata)).toBe(Object.prototype);
	});
});
