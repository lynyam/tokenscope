import "reflect-metadata";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Logger } from "@nestjs/common";

import { parseAnalyticsQuery } from "../../src/analytics/dto/analytics-query.dto";
import { AssistantService } from "../../src/assistant/assistant.service";
import { RateLimitService } from "../../src/common/rate-limit/rate-limit.service";
import { FakeAssistantProvider, delta, done, failure, gate, open, type FakeStep } from "../support/fake-assistant.provider";
import { RecordingResponse } from "../support/recording-response";

// The SSE fixtures shared with TSE-81 must be EXACTLY what the backend writes.
// Each transcript is generated here with the fake provider and compared byte for byte.

const dir = existsSync("/fixtures/evaluation")
	? "/fixtures/evaluation"
	: resolve(process.cwd(), "../fixtures/evaluation");
const readText = (name: string) => readFileSync(resolve(dir, name), "utf8");

const CONTEXT = JSON.parse(readText("assistant/context.json"));
const REQUEST = JSON.parse(readText("assistant/request.json"));
const FIRST = "fixture-b/demo-large has the highest estimated cost: $0.008200000000. ";
const SECOND = "These prices are synthetic. Café and € exercise UTF-8 decoding.";

async function settle(): Promise<void> {
	for (let i = 0; i < 20; i += 1) await new Promise(resolveTick => setImmediate(resolveTick));
}

describe("Assistant SSE fixtures", () => {
	let rateLimit: RateLimitService;
	let provider: FakeAssistantProvider;
	let service: AssistantService;
	let clock = 0;

	beforeEach(() => {
		jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick", "queueMicrotask"] });
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
		clock += 120_000;
		rateLimit = new RateLimitService({ now: () => clock });
		provider = new FakeAssistantProvider();
		service = new AssistantService(
			{ $transaction: async (work: (tx: unknown) => unknown) => work({}) } as never,
			{
				readSnapshotInTransaction: async () => ({
					snapshot: { ...CONTEXT, projectId: CONTEXT.project.id },
					project: CONTEXT.project,
					pricing: CONTEXT.pricing,
				}),
			} as never,
			{ assertProjectAccess: async () => ({}) } as never,
			rateLimit,
			provider,
		);
	});

	afterEach(() => {
		rateLimit.onModuleDestroy();
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	// Runs the fixture request with `script`; `during` can act while it runs.
	async function generate(script: FakeStep[], during?: (res: RecordingResponse) => Promise<void>): Promise<string> {
		provider.script = script;
		const res = new RecordingResponse();
		const promise = service.ask({
			requestId: "assistant-demo-001",
			userId: "user-fixture",
			organizationId: "org-fixture",
			projectId: CONTEXT.project.id,
			tokenExpiresAt: Date.now() + 3_600_000,
			question: REQUEST.question,
			query: parseAnalyticsQuery({ from: REQUEST.from, to: REQUEST.to }, new Date(), true),
		}, res.asResponse());

		if (during) {
			await settle();
			await during(res);
		}
		await promise;
		return res.chunks.join("");
	}

	it("success.sse", async () => {
		expect(await generate([delta(FIRST), delta(SECOND), done()])).toBe(readText("assistant/success.sse"));
	});

	it("length.sse", async () => {
		expect(await generate([delta(FIRST), done("length")])).toBe(readText("assistant/length.sse"));
	});

	it("refusal.sse", async () => {
		expect(await generate([open(), failure("refused")])).toBe(readText("assistant/refusal.sse"));
	});

	it("partial-timeout.sse (text, then the 60 s deadline)", async () => {
		const output = await generate([delta(FIRST), gate()], async () => {
			await jest.advanceTimersByTimeAsync(60_000);
		});
		expect(output).toBe(readText("assistant/partial-timeout.sse"));
	});

	it("unexpected-eof.sse (connection cut: no terminal event)", async () => {
		let atCut = "";
		await generate([delta(FIRST), gate()], async res => {
			atCut = res.chunks.join("");
			res.disconnect();
		});
		expect(atCut).toBe(readText("assistant/unexpected-eof.sse"));
	});
});
