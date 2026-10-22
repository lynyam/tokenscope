import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request = require("supertest");

import * as queries from "../../src/analytics/analytics.queries";
import { AppModule } from "../../src/app.module";
import { ASSISTANT_PROVIDER } from "../../src/assistant/assistant.provider";
import { ASSISTANT_LIMITS } from "../../src/assistant/assistant.service";
import { TokenService } from "../../src/auth/token.service";
import { RateLimitClock } from "../../src/common/rate-limit/rate-limit.service";
import { configureApp } from "../../src/configure-app";
import { PrismaService } from "../../src/database/prisma.service";
import { PricingService } from "../../src/pricing/pricing.service";
import { ProjectAccessService } from "../../src/projects/project-access.service";
import { FakeAssistantProvider, delta, done, failure, gate } from "../support/fake-assistant.provider";
import { resetTestDatabase } from "../support/reset-test-database";
import { SseConnection } from "../support/sse-client";

// --- fixtures -------------------------------------------------------------

const dir = existsSync("/fixtures/evaluation")
	? "/fixtures/evaluation"
	: resolve(process.cwd(), "../fixtures/evaluation");
const read = (name: string) => JSON.parse(readFileSync(resolve(dir, name), "utf8"));

const golden: Array<{ body: Record<string, unknown> }> = read("traces-golden.json");
const prices: Array<Record<string, unknown>> = read("model-prices.json");
const CONTEXT = read("assistant/context.json");
const VALID = read("assistant/request.json"); // golden window, no filters
const DEFAULT_LIMITS = { ...ASSISTANT_LIMITS };

// Waits until `check()` is true (real timers, small steps).
async function waitUntil(check: () => boolean, timeoutMs = 5000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("Condition not reached in time");
		await new Promise(resolveTick => setTimeout(resolveTick, 20));
	}
}

describe("Assistant with PostgreSQL", () => {
	let app: INestApplication;
	let server: Server;
	let db: PrismaService;
	let tokens: TokenService;
	let jwt: JwtService;
	let key: string;
	let traceIds: string[];
	let now = 0;

	const provider = new FakeAssistantProvider();

	const owner = randomUUID();
	const admin = randomUUID();
	const member = randomUUID();
	const outsider = randomUUID();
	const org = randomUUID();
	const otherOrg = randomUUID();
	const project = randomUUID();
	const otherProject = randomUUID();

	const pathFor = (orgId = org, projectId = project) =>
		`/api/v1/organizations/${orgId}/projects/${projectId}/assistant`;

	const bearer = (id = owner) => tokens.signAccessToken(id).accessToken;

	// Opens one streaming question.
	const ask = (actor = owner, body: unknown = VALID, path = pathFor()) =>
		SseConnection.open(server, path, bearer(actor), body);

	// Reads the dashboard analytics for the same selection (the source of truth).
	const analytics = (query: Record<string, string> = {}) =>
		request(server)
			.get(`/api/v1/organizations/${org}/projects/${project}/analytics`)
			.set("Authorization", `Bearer ${bearer()}`)
			.query({ from: VALID.from, to: VALID.to, ...query })
			.expect(200);

	// Ingests one more golden-like trace through the public API.
	const ingest = (patch: Record<string, unknown> = {}) =>
		request(server)
			.post("/api/v1/public/traces")
			.set("X-API-Key", key)
			.send({ ...golden[0].body, externalId: randomUUID(), ...patch });

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
			.overrideProvider(ASSISTANT_PROVIDER).useValue(provider)
			.overrideProvider(RateLimitClock).useValue({ now: () => now })
			.compile();

		app = moduleRef.createNestApplication({ logger: false, rawBody: true });
		configureApp(app);
		await app.listen(0, "127.0.0.1");

		server = app.getHttpServer();
		db = app.get(PrismaService);
		tokens = app.get(TokenService);
		jwt = app.get(JwtService);
	});

	beforeEach(async () => {
		now += 60_001;
		Object.assign(ASSISTANT_LIMITS, DEFAULT_LIMITS);
		provider.reset();
		provider.script = [delta("fixture-b/demo-large costs most."), done()];

		await resetTestDatabase(db);

		await db.user.createMany({
			data: [owner, admin, member, outsider].map((id, index) => ({
				id,
				email: `assistant-${index}@test.invalid`,
				displayName: `Actor ${index}`,
				passwordHash: "isolated-test-only",
			})),
		});
		await db.organization.createMany({
			data: [
				{ id: org, name: "Assistant", slug: "assistant" },
				{ id: otherOrg, name: "Other", slug: "other" },
			],
		});
		await db.membership.createMany({
			data: [
				{ userId: owner, organizationId: org, role: "OWNER" },
				{ userId: admin, organizationId: org, role: "ADMIN" },
				{ userId: member, organizationId: org, role: "MEMBER" },
				{ userId: outsider, organizationId: otherOrg, role: "OWNER" },
			],
		});
		await db.project.createMany({
			data: [
				{ id: project, organizationId: org, name: "Golden", slug: "golden", description: "Stored description" },
				{ id: otherProject, organizationId: otherOrg, name: "Private", slug: "private" },
			],
		});

		await app.get(PricingService).loadCatalogue(prices);

		const response = await request(server)
			.post(`/api/v1/organizations/${org}/projects/${project}/api-keys`)
			.set("Authorization", `Bearer ${bearer()}`)
			.send({ name: "Assistant integration" })
			.expect(201);
		key = response.body.key;

		traceIds = [];
		for (const row of golden) {
			traceIds.push((await ingest(row.body).expect(201)).body.id);
		}
	});

	afterEach(() => {
		Object.assign(ASSISTANT_LIMITS, DEFAULT_LIMITS);
		jest.restoreAllMocks();
	});

	afterAll(async () => {
		await app?.close();
	});

	// --- roles and isolation --------------------------------------------------------

	it.each([["OWNER", owner], ["ADMIN", admin], ["MEMBER", member]])(
		"lets an %s ask and receive the golden context from the database",
		async (_role, actor) => {
			const sse = await ask(actor);
			await sse.waitForEnd();

			expect(sse.status).toBe(200);
			expect(sse.events.map(e => e.event)).toEqual(["start", "delta", "done"]);
			expect(sse.events[0].data.context).toEqual({
				...CONTEXT,
				snapshotId: expect.any(String),
				generatedAt: expect.any(String),
				project: { id: project, name: "Golden", description: "Stored description" },
			});
		},
	);

	it("matches the golden figures of the shared analytics response", async () => {
		const sse = await ask();
		await sse.waitForEnd();
		const context = sse.events[0].data.context;
		const dashboard = (await analytics()).body;

		expect(context.summary).toEqual(dashboard.summary);
		expect(context.series).toEqual(dashboard.series);
		expect(context.byModel).toEqual(dashboard.byModel);
		expect(context.summary).toMatchObject({
			traceCount: 6,
			inputTokens: "6000",
			outputTokens: "1200",
			totalTokens: "7200",
			estimatedCostUsd: "0.015350000000",
			errorCount: 2,
			errorRatePct: 33.33,
			averageLatencyMs: 1833.333,
		});
		expect(context.byModel).toEqual(expect.arrayContaining([
			expect.objectContaining({ provider: "fixture-b", model: "demo-large", estimatedCostUsd: "0.008200000000" }),
			expect.objectContaining({ provider: "fixture-a", model: "demo-fast", estimatedCostUsd: "0.007150000000" }),
		]));
		expect(context.pricing).toEqual({ currency: "USD", containsSyntheticPricing: true });
	});

	it.each([
		["an outsider", outsider, pathFor()],
		["a cross-organization path", owner, pathFor(otherOrg, project)],
		["another tenant's project", owner, pathFor(org, otherProject)],
		["an unknown project", owner, pathFor(org, randomUUID())],
	])("rejects %s with 404 and no provider call", async (_label, actor, path) => {
		const response = await request(server)
			.post(path)
			.set("Authorization", `Bearer ${bearer(actor)}`)
			.send(VALID)
			.expect(404);
		expect(response.body.code).toBe("PROJECT_NOT_FOUND");
		expect(provider.calls).toBe(0);
	});

	it.each(["project", "organization"] as const)("rejects an archived %s", async kind => {
		if (kind === "project") {
			await db.project.update({ where: { id: project }, data: { archivedAt: new Date() } });
		} else {
			await db.organization.update({ where: { id: org }, data: { archivedAt: new Date() } });
		}
		const response = await request(server).post(pathFor()).set("Authorization", `Bearer ${bearer()}`).send(VALID);
		expect(response.status).toBe(404);
		expect(response.body.code).toBe("PROJECT_NOT_FOUND");
		expect(provider.calls).toBe(0);
	});

	// --- data selection ---------------------------------------------------------------------

	it("excludes deleted traces", async () => {
		await db.trace.update({ where: { id: traceIds[0] }, data: { deletedAt: new Date() } });
		const sse = await ask();
		await sse.waitForEnd();
		expect(sse.events[0].data.context.summary.traceCount).toBe(5);
	});

	it("uses the same boundaries and combined filters as the analytics", async () => {
		const selections: Array<Record<string, string>> = [
			{ from: "2026-10-01T11:00:00.000Z", to: "2026-10-01T12:00:00.000Z" },
			{ provider: "fixture-a", status: "SUCCESS" },
			{ model: "demo-large", status: "ERROR" },
			{ q: "support" },
		];

		for (const selection of selections) {
			now += 60_001; // keep under the per-minute limit
			const { from, to, ...filters } = selection;
			const body = { ...VALID, from: from ?? VALID.from, to: to ?? VALID.to, filters };
			const dashboard = (await analytics(selection)).body;

			if (dashboard.summary.traceCount === 0) {
				const empty = await request(server).post(pathFor()).set("Authorization", `Bearer ${bearer()}`).send(body);
				expect(empty.body.code).toBe("ASSISTANT_NO_DATA");
				continue;
			}

			const sse = await ask(owner, body);
			await sse.waitForEnd();
			expect(sse.events[0].data.context.summary).toEqual(dashboard.summary);
			expect(sse.events[0].data.context.filters).toEqual(dashboard.filters);
		}
	});

	it("counts every matching trace, well beyond 20", async () => {
		const original = await db.trace.findUniqueOrThrow({ where: { id: traceIds[0] } });
		await db.trace.createMany({
			data: Array.from({ length: 25 }, (_, index) => ({
				...original,
				id: randomUUID(),
				externalId: `many-${index}`,
				metadata: {},
			})),
		});

		const sse = await ask();
		await sse.waitForEnd();
		expect(sse.events[0].data.context.summary.traceCount).toBe(31);
		expect(sse.events[0].data.context.summary).toEqual((await analytics()).body.summary);
	});

	it("returns 422 ASSISTANT_NO_DATA for an empty selection", async () => {
		const response = await request(server)
			.post(pathFor())
			.set("Authorization", `Bearer ${bearer()}`)
			.send({ ...VALID, filters: { workflow: "absent" } })
			.expect(422);
		expect(response.body.code).toBe("ASSISTANT_NO_DATA");
		expect(provider.calls).toBe(0);
	});

	// --- consistency and frozen snapshot ----------------------------------------------------

	it("keeps one consistent snapshot when a write commits while the context is built", async () => {
		const readSummary = queries.readSummary;
		jest.spyOn(queries, "readSummary").mockImplementationOnce(async (tx, where) => {
			const summary = await readSummary(tx, where);
			// Commits on another connection between the summary and chart queries.
			await ingest().expect(201);
			await db.project.update({ where: { id: project }, data: { description: "Changed concurrently" } });
			return summary;
		});

		const sse = await ask();
		await sse.waitForEnd();
		const context = sse.events[0].data.context;

		expect(context.summary.traceCount).toBe(6);
		expect(context.series.reduce((sum: number, row: { traceCount: number }) => sum + row.traceCount, 0)).toBe(6);
		expect(context.byModel.reduce((sum: number, row: { traceCount: number }) => sum + row.traceCount, 0)).toBe(6);
		expect(context.project.description).toBe("Stored description");
	});

	it("does not change an answer's context after it was built; the next question sees the changes", async () => {
		const pause = gate();
		provider.script = [delta("working"), pause, done()];
		const first = await ask();
		await first.waitForEvents(2);

		await ingest().expect(201);
		await db.trace.update({ where: { id: traceIds[1] }, data: { deletedAt: new Date() } });
		await db.project.update({ where: { id: project }, data: { name: "Renamed" } });

		pause.open();
		await first.waitForEnd();
		expect(first.events[0].data.context.summary.traceCount).toBe(6);
		expect(first.events[0].data.context.project.name).toBe("Golden");
		expect(provider.lastContext?.summary.traceCount).toBe(6);

		provider.script = [delta("again"), done()];
		const second = await ask();
		await second.waitForEnd();
		expect(second.events[0].data.context.summary).toEqual((await analytics()).body.summary);
		expect(second.events[0].data.context.snapshotId).not.toBe(first.events[0].data.context.snapshotId);
		expect(second.events[0].data.context.project.name).toBe("Renamed");
	});

	// --- live authorization during the answer ----------------------------------------------

	it.each(["membership", "project", "organization"] as const)(
		"stops the output when %s access is lost during generation",
		async kind => {
			ASSISTANT_LIMITS.recheckEveryMs = 100;
			provider.script = [delta("working"), gate()];
			const sse = await ask(member);
			await sse.waitForEvents(2);

			if (kind === "membership") {
				await db.membership.delete({ where: { organizationId_userId: { organizationId: org, userId: member } } });
			} else if (kind === "project") {
				await db.project.update({ where: { id: project }, data: { archivedAt: new Date() } });
			} else {
				await db.organization.update({ where: { id: org }, data: { archivedAt: new Date() } });
			}

			await sse.waitForEnd();
			expect(sse.events.map(e => e.event)).toEqual(["start", "delta", "error"]);
			expect(sse.events.at(-1)?.data.code).toBe("PROJECT_NOT_FOUND");
			expect(provider.lastSignal?.aborted).toBe(true);
		},
	);

	it("stops the output when the JWT expires", async () => {
		provider.script = [delta("working"), gate()];
		const shortToken = jwt.sign({ sub: owner }, { expiresIn: 2 });
		const sse = await SseConnection.open(server, pathFor(), shortToken, VALID);
		await sse.waitForEvents(2);

		await sse.waitForEnd(6000);
		expect(sse.events.at(-1)?.data.code).toBe("ACCESS_TOKEN_EXPIRED");
	}, 10_000);

	it("stops safely when an access re-check cannot complete", async () => {
		ASSISTANT_LIMITS.recheckEveryMs = 100;
		const access = app.get(ProjectAccessService);
		const real = access.assertProjectAccess.bind(access);
		let calls = 0;
		// Calls 1-3: first check, analytics (inside the transaction), pre-dispatch check.
		// Call 4 is the first periodic re-check: make it fail.
		jest.spyOn(access, "assertProjectAccess").mockImplementation(async (...args) => {
			calls += 1;
			if (calls >= 4) throw new Error("connection lost");
			return real(...args);
		});

		provider.script = [delta("working"), gate()];
		const sse = await ask();
		await sse.waitForEnd();
		expect(sse.events.at(-1)?.data.code).toBe("INTERNAL_SERVER_ERROR");
		expect(sse.body).not.toContain("connection lost");
	});

	// --- side effects and slot -----------------------------------------------------------

	it("does not change traces, prices or project information", async () => {
		const before = {
			traces: await db.trace.findMany({ orderBy: { id: "asc" } }),
			prices: await db.modelPrice.findMany({ orderBy: { id: "asc" } }),
			project: await db.project.findUniqueOrThrow({ where: { id: project } }),
		};

		const sse = await ask();
		await sse.waitForEnd();

		expect(await db.trace.findMany({ orderBy: { id: "asc" } })).toEqual(before.traces);
		expect(await db.modelPrice.findMany({ orderBy: { id: "asc" } })).toEqual(before.prices);
		expect(await db.project.findUniqueOrThrow({ where: { id: project } })).toEqual(before.project);
	});

	it("frees the slot after completion, failure and cancellation", async () => {
		// completion
		let sse = await ask();
		await sse.waitForEnd();

		// failure before the stream
		provider.script = [failure("busy")];
		await request(server).post(pathFor()).set("Authorization", `Bearer ${bearer()}`).send(VALID).expect(503);

		// cancellation
		provider.script = [delta("working"), gate()];
		sse = await ask();
		await sse.waitForEvents(2);
		sse.disconnect();
		await waitUntil(() => provider.lastSignal?.aborted === true);

		// a new question works (4th accepted attempt: still under 5 per minute)
		provider.script = [delta("ok"), done()];
		sse = await ask();
		await sse.waitForEnd();
		expect(sse.status).toBe(200);
	});
});
