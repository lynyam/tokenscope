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
import { TraceReadsService } from "../../src/traces/trace-reads.service";
import { parseTraceListQuery } from "../../src/traces/dto/trace-query.dto";
import { ProjectAccessService } from "../../src/projects/project-access.service";

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

	const windowQuery = {
		from: "2026-10-01T00:00:00.000Z",
		to: "2026-10-02T00:00:00.000Z",
	};

	const getTrace = (id: string, key = keyA.key) =>
		request(app.getHttpServer())
			.get(`/api/v1/public/traces/${id}`)
			.set("X-API-Key", key);

	const putTrace = (
		id: string,
		body: Record<string, unknown>,
		version = '"1"',
	) =>
		request(app.getHttpServer())
			.put(`/api/v1/public/traces/${id}`)
			.set("X-API-Key", keyA.key)
			.set("If-Match", version)
			.send(body);

	const deleteTrace = (id: string, version = '"1"') =>
		request(app.getHttpServer())
			.delete(`/api/v1/public/traces/${id}`)
			.set("X-API-Key", keyA.key)
			.set("If-Match", version);

	const listTraces = (extra: Record<string, string> = {}) =>
		request(app.getHttpServer())
			.get("/api/v1/public/traces")
			.set("X-API-Key", keyA.key)
			.query({ ...windowQuery, ...extra });

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

	it("paginates and searches the golden dataset in the database", async () => {
		for (const item of golden) {
			await post(item.body).expect(201);
		}

		const page1 = await listTraces({ pageSize: "2" }).expect(200);
		const page2 = await listTraces({ pageSize: "2", page: "2" }).expect(200);
		const page3 = await listTraces({ pageSize: "2", page: "3" }).expect(200);

		expect(page1.body.items.map((x: { externalId: string }) => x.externalId))
			.toEqual(["golden-006", "golden-005"]);
		expect(page2.body.items.map((x: { externalId: string }) => x.externalId))
			.toEqual(["golden-004", "golden-003"]);
		expect(page3.body.items.map((x: { externalId: string }) => x.externalId))
			.toEqual(["golden-002", "golden-001"]);

		expect(page1.body.total).toBe(6);
		expect(page1.body.totalPages).toBe(3);

		const search = await listTraces({ q: "SUPPORT" }).expect(200);
		expect(search.body.items.map((x: { externalId: string }) => x.externalId).sort())
			.toEqual(["golden-001", "golden-003", "golden-004"]);

		const filtered = await listTraces({
			provider: "fixture-b",
			status: "ERROR",
		}).expect(200);

		expect(filtered.body.items.map((x: { externalId: string }) => x.externalId).sort())
			.toEqual(["golden-004", "golden-006"]);

		const costs = await listTraces({ sortBy: "estimatedCostUsd" }).expect(200);
		expect(costs.body.items.map((x: { externalId: string }) => x.externalId))
			.toEqual([
				"golden-006", "golden-002", "golden-003",
				"golden-001", "golden-005", "golden-004",
			]);
	});

	it("searches percent, underscore and backslash literally", async () => {
		await post({
			...golden[0].body,
			externalId: "literal",
			workflow: "Rate 50%_\\done",
		}).expect(201);

		await post({
			...golden[0].body,
			externalId: "other",
			workflow: "Rate 50XYZdone",
		}).expect(201);

		for (const q of ["%", "_", "\\"]) {
			const result = await listTraces({ q }).expect(200);
			expect(result.body.items.map((x: { externalId: string }) => x.externalId))
				.toEqual(["literal"]);
		}
	});

	it("uses inclusive from and exclusive to boundaries", async () => {
		await post({
			...golden[0].body,
			externalId: "at-from",
			occurredAt: windowQuery.from,
		}).expect(201);

		await post({
			...golden[0].body,
			externalId: "at-to",
			occurredAt: windowQuery.to,
		}).expect(201);

		const result = await listTraces().expect(200);
		expect(result.body.items.map((x: { externalId: string }) => x.externalId))
			.toEqual(["at-from"]);
	});

	it("keeps counts scoped and returns actual totals for an out-of-range page", async () => {
		await post().expect(201);
		await post(golden[0].body, keyB.key).expect(201);

		const result = await listTraces({ page: "20" }).expect(200);

		expect(result.body).toMatchObject({
			items: [],
			total: 1,
			totalPages: 1,
		});
	});

	it("returns detail outside the default window and hides cross-project rows", async () => {
		const created = await post().expect(201);

		await getTrace(created.body.id).expect(200).expect("ETag", '"1"');

		const denied = await getTrace(created.body.id, keyB.key).expect(404);
		expect(denied.body.code).toBe("TRACE_NOT_FOUND");
	});

	it.each(["OWNER", "ADMIN", "MEMBER"] as const)(
		"allows browser reads for %s",
		async role => {
			await db.membership.update({
				where: {
					organizationId_userId: {
						organizationId: orgA,
						userId: owner,
					},
				},
				data: { role },
			});

			const created = await post().expect(201);
			const path =
				`/api/v1/organizations/${orgA}/projects/${projectA}/traces`;

			await request(app.getHttpServer())
				.get(path)
				.query(windowQuery)
				.set("Authorization", bearer())
				.expect(200);

			await request(app.getHttpServer())
				.get(`${path}/${created.body.id}`)
				.set("Authorization", bearer())
				.expect(200);

			await request(app.getHttpServer())
				.post(path)
				.set("Authorization", bearer())
				.send(golden[0].body)
				.expect(404);
		},
	);

	it("rejects outsiders and mismatched browser route IDs", async () => {
		const outsider = randomUUID();

		await db.user.create({
			data: {
				id: outsider,
				email: "outsider@trace-crud.test",
				displayName: "Outsider",
				passwordHash: "fixture-only",
			},
		});

		const path =
			`/api/v1/organizations/${orgA}/projects/${projectA}/traces`;

		const denied = await request(app.getHttpServer())
			.get(path)
			.set(
				"Authorization",
				"Bearer " + tokens.signAccessToken(outsider).accessToken,
			)
			.expect(404);

		expect(denied.body.code).toBe("PROJECT_NOT_FOUND");

		await request(app.getHttpServer())
			.get(`/api/v1/organizations/${orgB}/projects/${projectA}/traces`)
			.set("Authorization", bearer())
			.expect(404);
	});

	it("distinguishes missing, malformed and stale If-Match", async () => {
		const created = await post().expect(201);
		const id = created.body.id;

		const missing = await request(app.getHttpServer())
			.put(`/api/v1/public/traces/${id}`)
			.set("X-API-Key", keyA.key)
			.send(golden[0].body)
			.expect(428);

		expect(missing.body.code).toBe("TRACE_VERSION_REQUIRED");

		await putTrace(id, golden[0].body, "1").expect(400);

		const stale = await putTrace(id, golden[0].body, '"2"').expect(412);
		expect(stale.body.code).toBe("TRACE_VERSION_CONFLICT");
		expect(stale.body.requestId).toBeTruthy();

		const stored = await db.trace.findUniqueOrThrow({ where: { id } });
		expect(stored.version).toBe(1);
	});

	it("preserves a no-op and does not consult new pricing", async () => {
		const created = await post({
			...golden[0].body,
			metadata: { b: 2, a: 1 },
		}).expect(201);

		published.mockClear();

		const pricingSpy = jest.spyOn(pricing, "findEffectivePrice");

		const same = await putTrace(created.body.id, {
			...golden[0].body,
			metadata: { a: 1, b: 2 },
		}).expect(200);

		expect(same.body).toEqual(created.body);
		expect(pricingSpy).not.toHaveBeenCalled();
		expect(published).not.toHaveBeenCalled();

		await putTrace(created.body.id, {
			...golden[0].body,
			metadata: { a: 1, b: 2 },
		}, '"2"').expect(412);
	});

	it("updates costs, hash, metadata and version atomically", async () => {
		const created = await post({
			...golden[0].body,
			metadata: { previous: true },
		}).expect(201);

		published.mockClear();

		const replacement = {
			...golden[0].body,
			inputTokens: 2000,
			outputTokens: 400,
			// Omit metadata from the JSON request to verify PUT resets it to {}.
			metadata: undefined,
		};

		const updated = await putTrace(created.body.id, replacement)
			.expect(200)
			.expect("ETag", '"2"');

		expect(updated.body.version).toBe(2);
		expect(updated.body.metadata).toEqual({});
		expect(updated.body.estimatedCostUsd).toBe("0.003600000000");
		expect(published).toHaveBeenCalledTimes(1);

		// POST replay now compares against the corrected content.
		await post(replacement).expect(200);
		await post(golden[0].body).expect(409);
	});

	it("does not partially change a trace when pricing is missing", async () => {
		const created = await post().expect(201);
		published.mockClear();

		const result = await putTrace(created.body.id, {
			...golden[0].body,
			model: "missing-model",
		}).expect(400);

		expect(result.body.code).toBe("MODEL_PRICE_NOT_FOUND");

		const current = await getTrace(created.body.id).expect(200);
		expect(current.body).toEqual(created.body);
		expect(published).not.toHaveBeenCalled();
	});

	it("keeps externalId immutable", async () => {
		const created = await post().expect(201);

		await putTrace(created.body.id, {
			...golden[0].body,
			externalId: "changed-identity",
		}).expect(400);

		const result = await getTrace(created.body.id).expect(200);
		expect(result.body.version).toBe(1);
	});

	it("serializes two genuinely changed corrections using the same version", async () => {
		const created = await post().expect(201);
		published.mockClear();

		const original = pricing.findEffectivePrice.bind(pricing);
		let arrivals = 0;
		let release!: () => void;
		const bothReady = new Promise<void>(resolve => { release = resolve; });

		jest.spyOn(pricing, "findEffectivePrice").mockImplementation(
			async (tx, provider, model, occurredAt) => {
				const price = await original(tx, provider, model, occurredAt);
				arrivals += 1;
				if (arrivals === 2) release();
				await bothReady;
				return price;
			},
		);

		const results = await Promise.all([
			putTrace(created.body.id, { ...golden[0].body, inputTokens: 2000 }),
			putTrace(created.body.id, { ...golden[0].body, inputTokens: 3000 }),
		]);

		expect(results.map(result => result.status).sort()).toEqual([200, 412]);
		expect(results.find(result => result.status === 412)?.body.code)
			.toBe("TRACE_VERSION_CONFLICT");

		const row = await db.trace.findUniqueOrThrow({
			where: { id: created.body.id },
		});

		expect(row.version).toBe(2);
		expect(published).toHaveBeenCalledTimes(1);
	});

	it("prevents a delayed stale DELETE from removing a correction", async () => {
		const created = await post().expect(201);
		const principal = await auth.authenticate(keyA.key);

		await putTrace(created.body.id, {
			...golden[0].body,
			inputTokens: 2000,
		}).expect(200);

		await expect(
			traces.remove(principal, created.body.id, '"1"'),
		).rejects.toMatchObject({ code: "TRACE_VERSION_CONFLICT" });

		await getTrace(created.body.id).expect(200).expect("ETag", '"2"');
	});

	it("soft-deletes and retains the external identity", async () => {
		const created = await post().expect(201);
		published.mockClear();

		const result = await deleteTrace(created.body.id).expect(204);
		expect(result.text).toBe("");

		await getTrace(created.body.id).expect(404);
		await deleteTrace(created.body.id).expect(404);

		const replay = await post().expect(409);
		expect(replay.body.code).toBe("TRACE_DELETED");

		const list = await listTraces().expect(200);
		expect(list.body.total).toBe(0);

		const row = await db.trace.findUniqueOrThrow({
			where: { id: created.body.id },
		});

		expect(row.deletedAt).not.toBeNull();
		expect(row.version).toBe(2);
		expect(published).toHaveBeenCalledTimes(1);
	});

	it("does not misreport a committed replacement when publication fails", async () => {
		const created = await post().expect(201);
		published.mockRejectedValueOnce(new Error("unavailable"));

		await putTrace(created.body.id, {
			...golden[0].body,
			inputTokens: 2000,
		}).expect(200);

		await getTrace(created.body.id).expect(200).expect("ETag", '"2"');
	});

	it.each(["revoke", "project", "organization"] as const)(
		"denies reads and mutations after %s",
		async operation => {
			const created = await post().expect(201);

			if (operation === "revoke") {
				await db.apiKey.update({
					where: { id: keyA.id },
					data: { revokedAt: new Date() },
				});
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

			await getTrace(created.body.id).expect(401);
			await listTraces().expect(401);
			await putTrace(created.body.id, golden[0].body).expect(401);
			await deleteTrace(created.body.id).expect(401);
		},
	);

	it("shares the public IP quota across list and detail", async () => {
		const created = await post().expect(201);

		// Start a fresh limiter window after setup and creation.
		now += 60_001;

		for (let index = 0; index < 60; index += 1) {
			if (index % 2 === 0) {
				await getTrace(created.body.id).expect(200);
			} else {
				await listTraces().expect(200);
			}
		}

		const limited = await getTrace(created.body.id).expect(429);
		expect(limited.body.code).toBe("RATE_LIMITED");
		expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
	});

	it("shares browser list/detail quota for the same user and project", async () => {
		const created = await post().expect(201);
		const path =
			`/api/v1/organizations/${orgA}/projects/${projectA}/traces`;

		now += 60_001;

		for (let index = 0; index < 60; index += 1) {
			await request(app.getHttpServer())
				.get(index % 2 === 0 ? path : `${path}/${created.body.id}`)
				.query(index % 2 === 0 ? windowQuery : {})
				.set("Authorization", bearer())
				.expect(200);
		}

		await request(app.getHttpServer())
			.get(path)
			.set("Authorization", bearer())
			.expect(429);
	});

	it("keeps authorization, count and rows in one read snapshot", async () => {
		await post().expect(201);
		const reads = app.get(TraceReadsService);
		const access = app.get(ProjectAccessService);
		const originalAccess = access.assertProjectAccess.bind(access);

		// The project-access query establishes the read snapshot.
		// A separately committed insertion must not appear halfway through it.
		jest.spyOn(access, "assertProjectAccess").mockImplementationOnce(
			async (...args) => {
				const project = await originalAccess(...args);

				await traces.ingest(
					await auth.authenticate(keyA.key),
					normalizeTracePayload({
						...golden[0].body,
						externalId: "committed-after-snapshot",
					}),
				);

				return project;
			},
		);

		const snapshot = await reads.listBrowser(
			owner,
			orgA,
			projectA,
			parseTraceListQuery(windowQuery),
		);

		expect(snapshot.total).toBe(1);
		expect(snapshot.items).toHaveLength(1);
		expect(await db.trace.count({ where: { projectId: projectA } })).toBe(2);
	});
});
