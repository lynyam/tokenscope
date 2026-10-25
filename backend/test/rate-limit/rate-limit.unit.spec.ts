import {
	RateLimitClock,
	RateLimitService,
} from "../../src/common/rate-limit/rate-limit.service";

describe("Shared fixed-window limiter", () => {
	let now: number;
	let limits: RateLimitService;

	beforeEach(() => {
		now = 0;
		limits = new RateLimitService({
			now: () => now,
		} as RateLimitClock);
	});

	afterEach(() => limits.onModuleDestroy());

	it("counts across callers using the same namespace and identity", () => {
		expect(limits.consume("public:ip", "ip", 2).allowed).toBe(true);
		expect(limits.consume("public:ip", "ip", 2).allowed).toBe(true);
		expect(limits.consume("public:ip", "ip", 2)).toEqual({
			allowed: false,
			retryAfterSeconds: 60,
		});
	});

	it("rounds Retry-After upward and resets at expiry", () => {
		limits.consume("public:ip", "ip", 1);
		now = 1_001;

		expect(limits.consume("public:ip", "ip", 1)).toEqual({
			allowed: false,
			retryAfterSeconds: 59,
		});

		now = 60_000;
		expect(limits.consume("public:ip", "ip", 1).allowed).toBe(true);
	});

	it("keeps namespaces separate", () => {
		limits.consume("public:ip", "same", 1);

		expect(
			limits.consume("browser:user-project", "same", 1).allowed,
		).toBe(true);
	});

	it("fails closed at capacity without evicting active counters", () => {
		for (let i = 0; i < 10_000; i += 1) {
			expect(limits.consume("capacity", String(i), 1).allowed)
				.toBe(true);
		}

		expect(limits.consume("capacity", "new", 1).allowed)
			.toBe(false);
		expect(limits.consume("capacity", "0", 1).allowed)
			.toBe(false);

		now = 60_000;

		expect(limits.consume("capacity", "new", 1).allowed)
			.toBe(true);
	});
	it("does not charge either rolling budget when one rejects admission", () => {
		const project = { namespace: "assistant-project", identity: "p", limit: 1 };
		limits.consumeRolling([{ namespace: "assistant-user", identity: "a", limit: 1 }, project]);
		const otherUser = { namespace: "assistant-user", identity: "b", limit: 1 };
		expect(limits.consumeRolling([otherUser, project]).allowed).toBe(false);
		expect(limits.consumeRolling([otherUser, { ...project, identity: "other" }]).allowed).toBe(true);
	});

	it("bounds rolling counters and reclaims expired entries", () => {
		const budget = { namespace: "rolling-capacity", identity: "", limit: 1 };
		for (let i = 0; i < 10_000; i += 1) {
			expect(limits.consumeRolling([{ ...budget, identity: String(i) }]).allowed).toBe(true);
		}
		expect(limits.consumeRolling([{ ...budget, identity: "new" }]).allowed).toBe(false);
		now = 60_000;
		expect(limits.consumeRolling([{ ...budget, identity: "new" }]).allowed).toBe(true);
	});

});
