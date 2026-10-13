import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/configure-app";
import { PrismaService } from "../../src/database/prisma.service";
import { Prisma } from "../../src/generated/prisma/client";
import { TokenService } from "../../src/auth/token.service";
import { ApiKeyAuthService } from "../../src/api-keys/api-key-auth.service";
import { PricingService } from "../../src/pricing/pricing.service";
import { TracesService } from "../../src/traces/traces.service";
import { TraceChangesService } from "../../src/traces/trace-changes.service";
import { normalizeTracePayload } from "../../src/traces/trace-payload";
import { RateLimitClock } from "../../src/common/rate-limit/rate-limit.service";
import { resetTestDatabase } from "../support/reset-test-database";

function fixture<T>(name: string): T {
	const directory = existsSync("/fixtures/evaluation")
		? "/fixtures/evaluation"
		: resolve(process.cwd(), "../fixtures/evaluation");

	return JSON.parse(readFileSync(resolve(directory, name), "utf8")) as T;
}

const prices = fixture<Array<Record<string, unknown>>>("model-prices.json");
const golden = fixture<Array<{ body: Record<string, unknown> }>>(
	"traces-golden.json",
);

const expectedCosts = [
	"0.001800000000",
	"0.004000000000",
	"0.002800000000",
	"0.000000000000",
	"0.001350000000",
	"0.005400000000",
];

describe("Trace ingestion with PostgreSQL", () => {
	let app: INestApplication;
	let db: PrismaService;
	let pricing: PricingService;
	let traces: TracesService;
	let auth: ApiKeyAuthService;
	let tokens: TokenService;
	let keyA: { id: string; key: string };
	let keyB: { id: string; key: string };
	let unsubscribe: () => void;
	let now = 0;

	const published = jest.fn();
	const owner = randomUUID();
	const orgA = randomUUID();
	const orgB = randomUUID();
	const projectA = randomUUID();
	const projectB = randomUUID();

	const bearer = () => "Bearer " + tokens.signAccessToken(owner).accessToken;

	const post = (
		body: Record<string, unknown> = golden[0].body,
		key?: string,
	) => request(app.getHttpServer())
		.post("/api/v1/public/traces")
		.set("X-API-Key", key ?? keyA.key)
		.send(body);

	const createKey = async (organizationId: string, projectId: string) => {
		const response = await request(app.getHttpServer())
			.post(`/api/v1/organizations/${organizationId}/projects/${projectId}/api-keys`)
			.set("Authorization", bearer())
			.send({ name: "Trace integration" })
			.expect(201);

		return response.body;
	};

	beforeAll(async () => {
		const context = await Test.createTestingModule({
			imports: [AppModule],
		})
			.overrideProvider(RateLimitClock)
			.useValue({ now: () => now })
			.compile();

		app = context.createNestApplication({
			logger: false,
			rawBody: true,
		});
		configureApp(app);
		await app.init();

		db = app.get(PrismaService);
		pricing = app.get(PricingService);
		traces = app.get(TracesService);
		auth = app.get(ApiKeyAuthService);
		tokens = app.get(TokenService);

		unsubscribe = app.get(TraceChangesService).subscribe(published);
	});

	beforeEach(async () => {
		now += 60_001;
		published.mockReset();

		await resetTestDatabase(db);

		await db.user.create({
			data: {
				id: owner,
				email: "owner@trace-integration.test",
				displayName: "Owner",
				passwordHash: "fixture-only",
			},
		});

		await db.organization.createMany({
			data: [
				{ id: orgA, name: "A", slug: "trace-org-a" },
				{ id: orgB, name: "B", slug: "trace-org-b" },
			],
		});

		await db.membership.createMany({
			data: [
				{ userId: owner, organizationId: orgA, role: "OWNER" },
				{ userId: owner, organizationId: orgB, role: "OWNER" },
			],
		});

		await db.project.createMany({
			data: [
				{ id: projectA, organizationId: orgA, name: "A", slug: "a" },
				{ id: projectB, organizationId: orgB, name: "B", slug: "b" },
			],
		});

		await pricing.loadCatalogue(prices);
		keyA = await createKey(orgA, projectA);
		keyB = await createKey(orgB, projectB);
	});

	afterEach(() => jest.restoreAllMocks());

	afterAll(async () => {
		unsubscribe?.();
		await app?.close();
	});

	it("persists all golden estimates exactly, including ERROR traces", async () => {
		for (let index = 0; index < golden.length; index += 1) {
			const response = await post(golden[index].body).expect(201);

			expect(response.body.estimatedCostUsd).toBe(expectedCosts[index]);
			expect(response.body.projectId).toBe(projectA);
			expect(response.headers.etag).toBe('"1"');
			expect(response.body).not.toHaveProperty("payloadHash");
			expect(response.body).not.toHaveProperty("deletedAt");
		}

		const total = await db.trace.aggregate({
			_sum: { estimatedCostUsd: true },
		});

		expect(total._sum.estimatedCostUsd?.toFixed(12))
			.toBe("0.015350000000");
		expect(published).toHaveBeenCalledTimes(6);
	});

	it("preserves exact replay history and does not reprice", async () => {
		const first = await post().expect(201);

		await pricing.loadCatalogue([{
			...prices[0],
			id: randomUUID(),
			effectiveFrom: "2026-10-01T09:00:00Z",
			inputUsdPerMillion: "20",
			outputUsdPerMillion: "40",
		}]);

		const spy = jest.spyOn(pricing, "findEffectivePrice");
		const replay = await post().expect(200);

		expect(replay.body).toEqual(first.body);
		expect(spy).not.toHaveBeenCalled();
		expect(await db.trace.count()).toBe(1);
		expect(published).toHaveBeenCalledTimes(1);
	});

	it("keeps the same external ID independent between projects", async () => {
		const a = await post().expect(201);
		const b = await post(golden[0].body, keyB.key).expect(201);

		expect(a.body.id).not.toBe(b.body.id);
		expect(a.body.projectId).toBe(projectA);
		expect(b.body.projectId).toBe(projectB);
		expect(await db.trace.count()).toBe(2);
	});

	it("rejects changed payloads and tombstone resurrection", async () => {
		const first = await post().expect(201);

		const conflict = await post({
			...golden[0].body,
			inputTokens: 1001,
		}).expect(409);

		expect(conflict.body.code).toBe("TRACE_EXTERNAL_ID_CONFLICT");

		await db.trace.update({
			where: { id: first.body.id },
			data: { deletedAt: new Date() },
		});

		const deleted = await post().expect(409);
		expect(deleted.body.code).toBe("TRACE_DELETED");
		expect(await db.trace.count()).toBe(1);
		expect(published).toHaveBeenCalledTimes(1);
	});

	it("creates once for ten simultaneous identical POSTs", async () => {
		const responses = await Promise.all(
			Array.from({ length: 10 }, () => post()),
		);

		expect(responses.filter(item => item.status === 201)).toHaveLength(1);
		expect(responses.filter(item => item.status === 200)).toHaveLength(9);
		expect(new Set(responses.map(item => item.body.id)).size).toBe(1);
		expect(await db.trace.count()).toBe(1);
		expect(published).toHaveBeenCalledTimes(1);
	});

	it("resolves simultaneous different bodies without mixed data", async () => {
		const responses = await Promise.all([
			post(),
			post({ ...golden[0].body, inputTokens: 2000 }),
		]);

		expect(responses.map(item => item.status).sort()).toEqual([201, 409]);

		const rejected = responses.find(item => item.status === 409);
		expect(rejected?.body.code).toBe("TRACE_EXTERNAL_ID_CONFLICT");

		const winner = responses.find(item => item.status === 201);
		const stored = await db.trace.findFirstOrThrow();

		expect(stored.inputTokens).toBe(winner?.body.inputTokens);
		expect(await db.trace.count()).toBe(1);
		expect(published).toHaveBeenCalledTimes(1);
	});

	it("uses the exact historical boundary and normalizes timestamps", async () => {
		const before = await post({
			...golden[0].body,
			externalId: "boundary-before",
			occurredAt: "2026-10-01T11:59:59.999Z",
		}).expect(201);

		const at = await post({
			...golden[0].body,
			externalId: "boundary-at",
			occurredAt: "2026-10-01T12:00:00Z",
		}).expect(201);

		expect(before.body.pricing.inputUsdPerMillion).toBe("1.000000");
		expect(at.body.pricing.inputUsdPerMillion).toBe("1.500000");
		expect(at.body.occurredAt).toBe("2026-10-01T12:00:00.000Z");

		await post({
			...golden[0].body,
			externalId: "boundary-at",
			occurredAt: "2026-10-01T12:00:00.000Z",
		}).expect(200);
	});

	it("does not substitute another provider/model or a future price", async () => {
		for (const patch of [
			{ provider: "fixture-b", model: "demo-fast" },
			{ provider: "fixture-a", model: "missing" },
			{ occurredAt: "2026-08-01T00:00:00Z" },
		]) {
			const response = await post({
				...golden[0].body,
				...patch,
			}).expect(400);

			expect(response.body.code).toBe("MODEL_PRICE_NOT_FOUND");
		}

		expect(await db.trace.count()).toBe(0);
		expect(published).not.toHaveBeenCalled();
	});

	it("persists maximum arithmetic and explicit zero pricing", async () => {
		await pricing.loadCatalogue([
			{
				...prices[0],
				id: randomUUID(),
				model: "maximum",
				inputUsdPerMillion: "999999.999999",
				outputUsdPerMillion: "999999.999999",
			},
			{
				...prices[0],
				id: randomUUID(),
				model: "free",
				inputUsdPerMillion: "0",
				outputUsdPerMillion: "0",
			},
		]);

		const maximum = await post({
			...golden[0].body,
			externalId: "maximum",
			model: "maximum",
			inputTokens: 1_000_000_000,
			outputTokens: 1_000_000_000,
		}).expect(201);

		expect(maximum.body.estimatedCostUsd)
			.toBe("1999999999.998000000000");

		const free = await post({
			...golden[0].body,
			externalId: "free",
			model: "free",
		}).expect(201);

		expect(free.body.estimatedCostUsd).toBe("0.000000000000");
	});

	it("rejects JWT-only ingestion and client project override", async () => {
		await request(app.getHttpServer())
			.post("/api/v1/public/traces")
			.set("Authorization", bearer())
			.send(golden[0].body)
			.expect(401);

		await post({
			...golden[0].body,
			projectId: projectB,
		}).expect(400);

		expect(await db.trace.count()).toBe(0);
	});

	it.each(["revoke", "project", "organization"] as const)(
		"rejects fresh ingestion after completed %s",
		async operation => {
			if (operation === "revoke") {
				await request(app.getHttpServer())
					.delete(`/api/v1/organizations/${orgA}/projects/${projectA}/api-keys/${keyA.id}`)
					.set("Authorization", bearer())
					.expect(204);
			} else if (operation === "project") {
				await db.project.update({
					where: { id: projectA },
					data: { archivedAt: new Date() },
				});
			} else {
				await db.organization.update({
					where: { id: orgA },
					data: { archivedAt: new Date() },
				});
			}

			const response = await post().expect(401);
			expect(response.body.code).toBe("INVALID_API_KEY");
			expect(await db.trace.count()).toBe(0);
		},
	);

	it("revalidates a principal authenticated before revocation", async () => {
		const principal = await auth.authenticate(keyA.key);

		await db.apiKey.update({
			where: { id: keyA.id },
			data: { revokedAt: new Date() },
		});

		await expect(traces.ingest(
			principal,
			normalizeTracePayload(golden[0].body),
		)).rejects.toMatchObject({ code: "INVALID_API_KEY" });

		expect(await db.trace.count()).toBe(0);
	});

	it("rolls back inserted data and does not publish if commit fails", async () => {
		const principal = await auth.authenticate(keyA.key);

		type Run = <T>(
			work: (tx: Prisma.TransactionClient) => Promise<T>,
			options?: {
				isolationLevel?: Prisma.TransactionIsolationLevel;
				maxWait?: number;
				timeout?: number;
			},
		) => Promise<T>;

		const original = db.$transaction.bind(db) as Run;
		const failure = new Error("forced rollback");

		const replacement: Run = (work, options) =>
			original(async tx => {
				await work(tx);
				throw failure;
			}, options);

		const spy = jest.spyOn(db, "$transaction");
		spy.mockImplementationOnce(replacement as typeof db.$transaction);

		await expect(traces.ingest(
			principal,
			normalizeTracePayload(golden[0].body),
		)).rejects.toBe(failure);

		spy.mockRestore();

		expect(await db.trace.count()).toBe(0);
		expect(published).not.toHaveBeenCalled();
	});

	it("does not report a committed trace as failed when publication fails", async () => {
		published.mockRejectedValueOnce(new Error("broadcast unavailable"));

		const response = await post().expect(201);
		expect(await db.trace.count()).toBe(1);

		const replay = await post().expect(200);
		expect(replay.body).toEqual(response.body);
		expect(published).toHaveBeenCalledTimes(1);
	});

	it("loads repeatably, refuses overwrites and prevents partial imports", async () => {
		await expect(pricing.loadCatalogue(prices)).resolves.toEqual({
			inserted: 0,
			unchanged: 3,
		});

		await expect(pricing.loadCatalogue([
			{
				...prices[0],
				id: randomUUID(),
				model: "must-not-be-inserted",
			},
			{
				...prices[0],
				inputUsdPerMillion: "99",
			},
		])).rejects.toMatchObject({ code: "MODEL_PRICE_CONFLICT" });

		expect(await db.modelPrice.count()).toBe(3);
		expect(await db.modelPrice.count({
			where: { model: "must-not-be-inserted" },
		})).toBe(0);
	});

	it("enforces the total catalogue limit without partial imports", async () => {
		const additions = Array.from({ length: 998 }, (_, index) => ({
			provider: "limit-test",
			model: `model-${index}`,
			effectiveFrom: "2026-09-01T00:00:00Z",
			inputUsdPerMillion: "0",
			outputUsdPerMillion: "0",
			currency: "USD",
			isSynthetic: true,
			sourceUrl: null,
		}));

		await expect(pricing.loadCatalogue(additions))
			.rejects.toMatchObject({ code: "VALIDATION_ERROR" });

		expect(await db.modelPrice.count()).toBe(3);
	});

	it("lists the catalogue using real JWT authentication and fixed decimals", async () => {
		await request(app.getHttpServer())
			.get("/api/v1/model-prices")
			.set("X-API-Key", keyA.key)
			.expect(401);

		const result = await request(app.getHttpServer())
			.get("/api/v1/model-prices")
			.query({ provider: " FIXTURE-A ", model: " DEMO-FAST " })
			.set("Authorization", bearer())
			.expect(200);

		expect(result.body).toHaveLength(2);
		expect(result.body.map((row: { inputUsdPerMillion: string }) =>
			row.inputUsdPerMillion,
		)).toEqual(["1.000000", "1.500000"]);

		expect(result.body[0].sourceUrl).toBeNull();
		expect(result.body[0].isSynthetic).toBe(true);
	});
});
