import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { HttpStatus, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");

import { AnalyticsService } from "../../src/analytics/analytics.service";
import { AppModule } from "../../src/app.module";
import { ASSISTANT_PROVIDER } from "../../src/assistant/assistant.provider";
import { TokenService } from "../../src/auth/token.service";
import { ApiException } from "../../src/common/errors/api.exception";
import { RateLimitClock } from "../../src/common/rate-limit/rate-limit.service";
import { configureApp } from "../../src/configure-app";
import { PrismaService } from "../../src/database/prisma.service";
import { ProjectAccessService } from "../../src/projects/project-access.service";
import { FakeAssistantProvider, delta, done, failure, gate, open as accepted } from "../support/fake-assistant.provider";
import { SseConnection } from "../support/sse-client";

const dir = existsSync("/fixtures/evaluation")
	? "/fixtures/evaluation"
	: resolve(process.cwd(), "../fixtures/evaluation");
const read = (name: string) => JSON.parse(readFileSync(resolve(dir, name), "utf8"));

const CONTEXT = read("assistant/context.json");
const VALID = read("assistant/request.json");

// Waits until `check()` is true (real timers, small steps).
async function waitUntil(check: () => boolean, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("Condition not reached in time");
		await new Promise(resolveTick => setTimeout(resolveTick, 10));
	}
}

describe("Assistant HTTP contract", () => {
	let app: INestApplication;
	let server: Server;
	let tokens: TokenService;
	let now = 0;

	const provider = new FakeAssistantProvider();
	const readSnapshotInTransaction = jest.fn();
	const assertProjectAccess = jest.fn();

	const userId = randomUUID();
	const organizationId = randomUUID();
	const projectId = randomUUID();
	const path = `/api/v1/organizations/${organizationId}/projects/${projectId}/assistant`;

	const token = (id = userId) => tokens.signAccessToken(id).accessToken;

	// Sends a request and reads the full (non-stream) response.
	const post = (body: unknown, id = userId) =>
		request(server)
			.post(path)
			.set("Authorization", `Bearer ${token(id)}`)
			.set("Accept", "text/event-stream")
			.send(body as object);

	// Opens a real streaming connection.
	const open = (body: unknown = VALID, raw?: string) => SseConnection.open(server, path, token(), body, raw);

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
			.overrideProvider(PrismaService).useValue({ $transaction: (work: (tx: unknown) => unknown) => work({}) })
			.overrideProvider(AnalyticsService).useValue({ readSnapshotInTransaction })
			.overrideProvider(ProjectAccessService).useValue({ assertProjectAccess })
			.overrideProvider(ASSISTANT_PROVIDER).useValue(provider)
			.overrideProvider(RateLimitClock).useValue({ now: () => now })
			.compile();

		app = moduleRef.createNestApplication({ logger: false, rawBody: true });
		configureApp(app);
		await app.listen(0, "127.0.0.1");
		server = app.getHttpServer();
		tokens = app.get(TokenService);
	});

	beforeEach(() => {
		now += 60_001; // fresh per-minute limits for every test
		provider.reset();
		provider.script = [delta("fixture-b/demo-large "), delta("costs most."), done()];
		readSnapshotInTransaction.mockReset().mockResolvedValue({
			snapshot: { ...CONTEXT, projectId },
			project: CONTEXT.project,
			pricing: CONTEXT.pricing,
		});
		assertProjectAccess.mockReset().mockResolvedValue({});
	});

	afterAll(async () => {
		await app?.close();
	});

	// --- success ---------------------------------------------------------------

	it("streams start, deltas and done with the exact SSE headers", async () => {
		const sse = await open();
		await sse.waitForEnd();

		expect(sse.status).toBe(200);
		expect(sse.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
		expect(sse.headers["cache-control"]).toBe("no-store");
		expect(sse.events.map(e => e.event)).toEqual(["start", "delta", "delta", "done"]);

		const start = sse.events[0].data;
		expect(start).toEqual({
			requestId: expect.any(String),
			provider: "gemini",
			model: "deterministic-test-only",
			context: CONTEXT,
		});
		expect(sse.headers["x-request-id"]).toBe(start.requestId);
		expect(sse.events[3].data).toEqual({ requestId: start.requestId, finishReason: "stop", usage: null });
	});

	it("delivers text before the provider has finished (incremental delivery)", async () => {
		const pause = gate();
		provider.script = [delta("first part"), pause, delta("second part"), done()];

		const sse = await open();
		await sse.waitForEvents(2);
		expect(sse.events.map(e => e.event)).toEqual(["start", "delta"]);
		expect(sse.ended).toBe(false);

		pause.open();
		await sse.waitForEnd();
		expect(sse.events.map(e => e.event)).toEqual(["start", "delta", "delta", "done"]);
	});

	it("sends one terminal event and never writes after it", async () => {
		provider.script = [delta("answer"), done(), delta("late text")];
		const sse = await open();
		await sse.waitForEnd();
		expect(sse.events.map(e => e.event)).toEqual(["start", "delta", "done"]);
		expect(sse.body).not.toContain("late text");
	});

	it("reports truncation as done/length", async () => {
		provider.script = [delta("partial"), done("length")];
		const sse = await open();
		await sse.waitForEnd();
		expect(sse.events.at(-1)?.data.finishReason).toBe("length");
	});

	// --- authentication and validation -------------------------------------------

	it("requires a JWT (project API keys are not accepted)", async () => {
		expect((await request(server).post(path).send(VALID).expect(401)).body.code).toBe("AUTHENTICATION_REQUIRED");
		expect((await request(server).post(path).set("X-API-Key", "tsk_any").send(VALID).expect(401)).body.code)
			.toBe("AUTHENTICATION_REQUIRED");
	});

	it("rejects invalid route UUIDs", async () => {
		const response = await request(server)
			.post("/api/v1/organizations/not-a-uuid/projects/also-bad/assistant")
			.set("Authorization", `Bearer ${token()}`)
			.send(VALID)
			.expect(400);
		expect(response.body.code).toBe("VALIDATION_ERROR");
	});

	it.each([
		["missing question", { from: VALID.from, to: VALID.to, filters: {} }],
		["blank question", { ...VALID, question: "   " }],
		["question too long", { ...VALID, question: "x".repeat(2001) }],
		["question not a string", { ...VALID, question: ["a"] }],
		["missing from", { question: "q", to: VALID.to, filters: {} }],
		["missing to", { question: "q", from: VALID.from, filters: {} }],
		["missing filters", { question: "q", from: VALID.from, to: VALID.to }],
		["filters not an object", { ...VALID, filters: [] }],
		["from after to", { ...VALID, from: VALID.to, to: VALID.from }],
		["equal dates", { ...VALID, to: VALID.from }],
		["more than 90 days", { ...VALID, from: "2026-01-01T00:00:00.000Z", to: "2026-04-02T00:00:00.000Z" }],
		["date without Z", { ...VALID, from: "2026-10-01T00:00:00.000" }],
		["relative label", { ...VALID, from: "last7days" }],
		["legacy traceId", { ...VALID, traceId: randomUUID() }],
		["client summary", { ...VALID, summary: { traceCount: 1 } }],
		["client project", { ...VALID, project: { name: "Fake", description: "x" } }],
		["model selection", { ...VALID, model: "gemini-pro" }],
		["pagination", { ...VALID, page: 2 }],
		["unknown nested filter", { ...VALID, filters: { traceId: "x" } }],
		["dates inside filters", { ...VALID, filters: { from: VALID.from } }],
		["bucket inside filters", { ...VALID, filters: { bucket: "day" } }],
		["array filter", { ...VALID, filters: { provider: ["openai"] } }],
		["object filter", { ...VALID, filters: { workflow: { a: 1 } } }],
		["bad status", { ...VALID, filters: { status: "OK" } }],
		["q too long", { ...VALID, filters: { q: "q".repeat(101) } }],
	])("rejects %s with 400 VALIDATION_ERROR", async (_label, body) => {
		const response = await post(body).expect(400);
		expect(response.body.code).toBe("VALIDATION_ERROR");
		expect(provider.calls).toBe(0);
		expect(assertProjectAccess).not.toHaveBeenCalled();
	});

	it.each([
		["q", { q: "  checkout  " }, { q: "checkout" }],
		["provider", { provider: " OpenAI " }, { provider: "openai" }],
		["model", { model: "GPT-4o" }, { model: "gpt-4o" }],
		["workflow", { workflow: "Checkout Flow" }, { workflow: "Checkout Flow" }],
		["status", { status: "ERROR" }, { status: "ERROR" }],
	])("accepts the %s filter and forwards it normalized", async (_label, filters, expected) => {
		const sse = await open({ ...VALID, filters });
		await sse.waitForEnd();
		expect(sse.status).toBe(200);

		const query = readSnapshotInTransaction.mock.calls[0][2];
		expect(query.filters).toEqual({
			from: new Date(VALID.from),
			to: new Date(VALID.to),
			...expected,
		});
		expect(query.bucket).toBe("hour");
	});

	it("picks the daily bucket for ranges longer than 48 hours", async () => {
		const sse = await open({ ...VALID, from: "2026-09-28T00:00:00.000Z", to: "2026-10-05T00:00:00.000Z" });
		await sse.waitForEnd();
		expect(readSnapshotInTransaction.mock.calls[0][2].bucket).toBe("day");
	});

	it("counts real bytes: multibyte text over 8 KiB is rejected even under 8 KiB characters", async () => {
		const body = { ...VALID, question: "😀".repeat(2000), filters: { workflow: "😀".repeat(80) } };
		const raw = JSON.stringify(body);
		expect(raw.length).toBeLessThan(8192);
		expect(Buffer.byteLength(raw)).toBeGreaterThan(8192);

		const response = await post(body).expect(413);
		expect(response.body.code).toBe("PAYLOAD_TOO_LARGE");
		expect(assertProjectAccess).not.toHaveBeenCalled();
	});

	it("rejects whitespace padding that pushes the body over 8 KiB", async () => {
		const raw = JSON.stringify(VALID) + " ".repeat(8192);
		const sse = await open(undefined, raw);
		await sse.waitForEnd();
		expect(sse.status).toBe(413);
	});

	it("rejects a non-JSON content type", async () => {
		const response = await request(server)
			.post(path)
			.set("Authorization", `Bearer ${token()}`)
			.set("Content-Type", "text/plain")
			.send("hello")
			.expect(415);
		expect(response.body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
	});

	// --- JSON errors before the stream vs error events after -------------------------

	it("returns 404 PROJECT_NOT_FOUND for an inaccessible project, without calling the provider", async () => {
		assertProjectAccess.mockRejectedValue(new ApiException(HttpStatus.NOT_FOUND, "PROJECT_NOT_FOUND", "Project not found."));
		const response = await post(VALID).expect(404);
		expect(response.body).toMatchObject({ code: "PROJECT_NOT_FOUND", requestId: expect.any(String) });
		expect(provider.calls).toBe(0);
	});

	it("returns 503 LLM_UNAVAILABLE when the provider is not configured", async () => {
		provider.configured = false;
		expect((await post(VALID).expect(503)).body.code).toBe("LLM_UNAVAILABLE");
	});

	it("returns 422 ASSISTANT_NO_DATA as JSON when no trace matches", async () => {
		readSnapshotInTransaction.mockResolvedValue({
			snapshot: { ...CONTEXT, summary: { ...CONTEXT.summary, traceCount: 0 } },
			project: CONTEXT.project,
			pricing: CONTEXT.pricing,
		});
		expect((await post(VALID).expect(422)).body.code).toBe("ASSISTANT_NO_DATA");
		expect(provider.calls).toBe(0);
	});

	it("returns a refusal before any text as JSON 422 LLM_REFUSED", async () => {
		provider.script = [failure("refused")];
		const response = await post(VALID).expect(422);
		expect(response.headers["content-type"]).toContain("application/json");
		expect(response.body).toMatchObject({ statusCode: 422, code: "LLM_REFUSED" });
	});

	it("returns a refusal right after the provider accepted the request as start + error", async () => {
		provider.script = [accepted(), failure("refused")];
		const sse = await open();
		await sse.waitForEnd();
		expect(sse.status).toBe(200);
		expect(sse.events.map(e => e.event)).toEqual(["start", "error"]);
		expect(sse.events.at(-1)?.data.code).toBe("LLM_REFUSED");
	});

	it("returns a refusal after text as one SSE error event (status already 200)", async () => {
		provider.script = [delta("I can"), failure("refused")];
		const sse = await open();
		await sse.waitForEnd();
		expect(sse.status).toBe(200);
		expect(sse.events.map(e => e.event)).toEqual(["start", "delta", "error"]);
		expect(sse.events.at(-1)?.data).toEqual({
			requestId: sse.events[0].data.requestId,
			code: "LLM_REFUSED",
			message: "The provider could not answer this question.",
			retryable: false,
		});
	});

	it("never turns an unexpected end of stream into success", async () => {
		provider.script = [delta("half")];
		const sse = await open();
		await sse.waitForEnd();
		expect(sse.events.at(-1)?.event).toBe("error");
		expect(sse.events.at(-1)?.data.code).toBe("LLM_PROVIDER_ERROR");
	});

	it("cleans up when provider initialization fails, so the next request works", async () => {
		provider.script = [failure("busy")];
		expect((await post(VALID).expect(503)).body.code).toBe("LLM_PROVIDER_BUSY");

		provider.script = [delta("ok"), done()];
		const sse = await open();
		await sse.waitForEnd();
		expect(sse.status).toBe(200);
	});

	// --- limits ----------------------------------------------------------------------

	it("allows 5 attempts per user per minute, then 429 with Retry-After", async () => {
		for (let i = 0; i < 5; i += 1) {
			const sse = await open();
			await sse.waitForEnd();
			expect(sse.status).toBe(200);
		}
		const response = await post(VALID).expect(429);
		expect(response.body.code).toBe("RATE_LIMITED");
		expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
	});

	it("rejects a second concurrent request from the same user", async () => {
		const pause = gate();
		provider.script = [delta("busy"), pause, done()];
		const first = await open();
		await first.waitForEvents(2);

		expect((await post(VALID).expect(429)).body.code).toBe("ASSISTANT_ALREADY_RUNNING");

		pause.open();
		await first.waitForEnd();
	});

	// --- cancellation and backpressure --------------------------------------------------

	it("aborts the provider and frees the slot when the client disconnects before the first text", async () => {
		provider.script = [gate(), delta("never"), done()];
		const pending = SseConnection.start(server, path, token(), VALID);
		await waitUntil(() => provider.calls === 1);

		// No headers yet: the server still waits for the first text.
		pending.disconnect();
		await waitUntil(() => provider.lastSignal?.aborted === true);

		provider.script = [delta("next"), done()];
		const next = await open();
		await next.waitForEnd();
		expect(next.status).toBe(200);
	});

	it("aborts the provider and frees the slot when the client disconnects mid-answer", async () => {
		provider.script = [delta("working"), gate(), delta("never sent"), done()];
		const sse = await open();
		await sse.waitForEvents(2);

		sse.disconnect();
		await waitUntil(() => provider.lastSignal?.aborted === true);

		provider.script = [delta("next"), done()];
		const next = await open();
		await next.waitForEnd();
		expect(next.status).toBe(200);
		expect(next.events.map(e => e.event)).toEqual(["start", "delta", "done"]);
	});

	it("stops reading the provider until a backpressured HTTP response drains", async () => {
		provider.script = [delta("one"), delta("two"), done()];
		let releaseDrain: (() => void) | undefined;
		let restoreWrite: (() => void) | undefined;

		// Inject one full-buffer result on this response only. Pausing the
		// HTTP client cannot reliably fill every platform's TCP buffers.
		const blockFirstDelta = (req: IncomingMessage, res: ServerResponse) => {
			if (req.method !== "POST" || req.url !== path) return;
			const write = res.write.bind(res);
			const spy = jest.spyOn(res, "write");
			restoreWrite = () => spy.mockRestore();
			spy.mockImplementation((...args: Parameters<typeof res.write>) => {
				if (!releaseDrain && typeof args[0] === "string" && args[0].startsWith("event: delta\n")) {
					// Retain exactly one frame, as a full write buffer would.
					releaseDrain = () => {
						spy.mockRestore();
						// If the actual write is also full, Node emits drain later.
						if (write(...args)) res.emit("drain");
					};
					return false;
				}
				return write(...args);
			});
		};

		server.prependListener("request", blockFirstDelta);
		const sse = SseConnection.start(server, path, token(), VALID);
		try {
			await sse.ready;
			await waitUntil(() => releaseDrain !== undefined);
			expect(provider.pulled).toBe(1);

			// Let pending work run: the second provider event must stay unread.
			await new Promise<void>(resolveTick => setImmediate(resolveTick));
			expect(provider.pulled).toBe(1);
			expect(sse.ended).toBe(false);

			releaseDrain!();
			await sse.waitForEnd();
			expect(sse.status).toBe(200);
			expect(provider.pulled).toBe(3);
			expect(sse.events.map(event => event.event)).toEqual(["start", "delta", "delta", "done"]);
			expect(sse.events.filter(event => event.event === "delta").map(event => event.data.text))
				.toEqual(["one", "two"]);
		} finally {
			server.off("request", blockFirstDelta);
			restoreWrite?.();
			sse.disconnect();
		}
	});
});
