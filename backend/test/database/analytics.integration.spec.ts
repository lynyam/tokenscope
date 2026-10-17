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
import { PricingService } from "../../src/pricing/pricing.service";
import { AnalyticsService } from "../../src/analytics/analytics.service";
import * as queries from "../../src/analytics/analytics.queries";
import { parseAnalyticsQuery } from "../../src/analytics/dto/analytics-query.dto";
import type { AnalyticsSnapshot } from "../../src/analytics/analytics.types";
import { RateLimitClock } from "../../src/common/rate-limit/rate-limit.service";
import { ProjectAccessService } from "../../src/projects/project-access.service";
import { resetTestDatabase } from "../support/reset-test-database";

function fixture<T>(name: string): T {
	const dir = existsSync("/fixtures/evaluation")
		? "/fixtures/evaluation"
		: resolve(process.cwd(), "../fixtures/evaluation");

	return JSON.parse(
		readFileSync(resolve(dir, name), "utf8"),
	) as T;
}

const golden = fixture<Array<{
	body: Record<string, unknown>;
}>>("traces-golden.json");

const expected = fixture<AnalyticsSnapshot>(
	"responses/analytics-golden.json",
);

const prices = fixture<Array<Record<string, unknown>>>(
	"model-prices.json",
);

const windowQuery = {
	from: expected.window.from,
	to: expected.window.to,
};

describe("Project analytics with PostgreSQL", () => {
	let app: INestApplication;
	let db: PrismaService;
	let analytics: AnalyticsService;
	let pricing: PricingService;
	let tokens: TokenService;
	let now = 0;
	let key: string;
	let traceIds: string[];

	const owner = randomUUID();
	const admin = randomUUID();
	const member = randomUUID();
	const outsider = randomUUID();

	const org = randomUUID();
	const otherOrg = randomUUID();

	const project = randomUUID();
	const emptyProject = randomUUID();
	const otherProject = randomUUID();

	const scope = {
		actorId: owner,
		organizationId: org,
		projectId: project,
	};

	const base =
		`/api/v1/organizations/${org}/projects/${project}`;

	const bearer = (id: string = owner) =>
		"Bearer " + tokens.signAccessToken(id).accessToken;

	const get = (
		extra: Record<string, string> = {},
		actor: string = owner,
		path = base,
	) =>
		request(app.getHttpServer())
			.get(path + "/analytics")
			.set("Authorization", bearer(actor))
			.query({ ...windowQuery, ...extra });

	const post = (patch: Record<string, unknown> = {}) =>
		request(app.getHttpServer())
			.post("/api/v1/public/traces")
			.set("X-API-Key", key)
			.send({
				...golden[0].body,
				externalId: randomUUID(),
				...patch,
			});

	const internal = () =>
		db.$transaction(
			tx => analytics.readSnapshotInTransaction(
				tx,
				scope,
				parseAnalyticsQuery(windowQuery),
			),
			{
				isolationLevel:
					Prisma.TransactionIsolationLevel.RepeatableRead,
			},
		);

	function reconcile(snapshot: AnalyticsSnapshot) {
		for (const rows of [snapshot.series, snapshot.byModel]) {
			expect(
				rows.reduce((n, row) => n + row.traceCount, 0),
			).toBe(snapshot.summary.traceCount);

			for (const field of ["inputTokens", "outputTokens"] as const) {
				expect(
					rows.reduce(
						(n, row) => n + BigInt(row[field]),
						0n,
					).toString(),
				).toBe(snapshot.summary[field]);
			}

			const Decimal = Prisma.Decimal.clone({ precision: 60 });

			expect(
				rows.reduce(
					(n, row) => n.plus(row.estimatedCostUsd),
					new Decimal(0),
				).toFixed(12),
			).toBe(snapshot.summary.estimatedCostUsd);
		}
	}

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
		analytics = app.get(AnalyticsService);
		pricing = app.get(PricingService);
		tokens = app.get(TokenService);
	});

	beforeEach(async () => {
		now += 60_001;
		await resetTestDatabase(db);

		await db.user.createMany({
			data: [owner, admin, member, outsider].map((id, index) => ({
				id,
				email: `analytics-${index}@test.invalid`,
				displayName: `Actor ${index}`,
				passwordHash: "isolated-test-only",
			})),
		});

		await db.organization.createMany({
			data: [
				{ id: org, name: "Analytics", slug: "analytics" },
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
				{
					id: project,
					organizationId: org,
					name: "Golden",
					slug: "golden",
					description: "Stored description",
				},
				{
					id: emptyProject,
					organizationId: org,
					name: "Empty",
					slug: "empty",
				},
				{
					id: otherProject,
					organizationId: otherOrg,
					name: "Private",
					slug: "private",
				},
			],
		});

		await pricing.loadCatalogue(prices);

		const response = await request(app.getHttpServer())
			.post(base + "/api-keys")
			.set("Authorization", bearer())
			.send({ name: "Analytics integration" })
			.expect(201);

		key = response.body.key;
		traceIds = [];

		for (const row of golden) {
			traceIds.push((await post(row.body).expect(201)).body.id);
		}

		// Control data in another tenant must never affect these totals.
		const original = await db.trace.findUniqueOrThrow({
			where: { id: traceIds[0] },
		});

		await db.trace.create({
			data: {
				...original,
				id: randomUUID(),
				projectId: otherProject,
				externalId: "private-control",
				metadata: {},
			},
		});
	});

	afterEach(() => jest.restoreAllMocks());

	afterAll(async () => {
		await app?.close();
	});

	it.each([owner, admin, member])(
		"returns the full canonical snapshot for member %s",
		async actor => {
			const { body } = await get({}, actor).expect(200);

			expect(body).toEqual({
				...expected,
				snapshotId: expect.any(String),
				generatedAt: expect.any(String),
				projectId: project,
			});

			reconcile(body);

			expect(
				(body as AnalyticsSnapshot).series.filter(
					row => row.traceCount === 0,
				),
			).toHaveLength(18);
		},
	);

	it("distinguishes authentication, inaccessible projects and empty data", async () => {
		await request(app.getHttpServer())
			.get(base + "/analytics")
			.expect(401);

		await request(app.getHttpServer())
			.get(base + "/analytics")
			.set("Authorization", "Bearer invalid")
			.expect(401);

		await request(app.getHttpServer())
			.get(base + "/analytics")
			.set("X-API-Key", key)
			.expect(401);

		for (const [actor, path] of [
			[outsider, base],
			[owner, `/api/v1/organizations/${otherOrg}/projects/${project}`],
			[owner, `/api/v1/organizations/${org}/projects/${otherProject}`],
			[owner, `/api/v1/organizations/${org}/projects/${randomUUID()}`],
		]) {
			expect(
				(await get({}, actor, path).expect(404)).body.code,
			).toBe("PROJECT_NOT_FOUND");
		}

		for (const response of [
			await get({ workflow: "absent" }).expect(200),
			await get(
				{},
				owner,
				`/api/v1/organizations/${org}/projects/${emptyProject}`,
			).expect(200),
		]) {
			expect(response.body.summary).toEqual({
				traceCount: 0,
				inputTokens: "0",
				outputTokens: "0",
				totalTokens: "0",
				estimatedCostUsd: "0.000000000000",
				errorCount: 0,
				errorRatePct: null,
				averageLatencyMs: null,
			});

			expect(response.body.byModel).toEqual([]);
			expect(response.body.series).toHaveLength(24);
			reconcile(response.body);
		}
	});

	it.each(["project", "organization", "membership"] as const)(
		"rejects a new snapshot after %s access loss",
		async kind => {
			if (kind === "project") {
				await db.project.update({
					where: { id: project },
					data: { archivedAt: new Date() },
				});
			}

			if (kind === "organization") {
				await db.organization.update({
					where: { id: org },
					data: { archivedAt: new Date() },
				});
			}

			if (kind === "membership") {
				await db.membership.delete({
					where: {
						organizationId_userId: {
							organizationId: org,
							userId: owner,
						},
					},
				});
			}

			expect((await get().expect(404)).body.code)
				.toBe("PROJECT_NOT_FOUND");

			await expect(internal()).rejects.toMatchObject({
				code: "PROJECT_NOT_FOUND",
			});
		},
	);

	it("returns authorized metadata and the historical synthetic flag internally only", async () => {
		const result = await internal();

		expect(result.project).toEqual({
			id: project,
			name: "Golden",
			description: "Stored description",
		});

		expect(result.pricing).toEqual({
			currency: "USD",
			containsSyntheticPricing: true,
		});

		expect(result.snapshot).not.toHaveProperty("project");
		expect(result.snapshot).not.toHaveProperty("pricing");

		const empty = await db.$transaction(
			tx => analytics.readSnapshotInTransaction(
				tx,
				{ ...scope, projectId: emptyProject },
				parseAnalyticsQuery(windowQuery),
			),
			{
				isolationLevel:
					Prisma.TransactionIsolationLevel.RepeatableRead,
			},
		);

		expect(empty.project.description).toBeNull();
		expect(empty.pricing.containsSyntheticPricing).toBe(false);
	});

	it("uses exact boundaries, partial UTC buckets and all filters like trace listing", async () => {
		const bounds = await get({
			from: "2026-10-01T11:00:00Z",
			to: "2026-10-01T12:00:00Z",
		}).expect(200);

		expect(bounds.body.summary.traceCount).toBe(1);
		expect(bounds.body.summary.inputTokens).toBe("2000");

		const partial = await get({
			from: "2026-10-01T10:30:00Z",
			to: "2026-10-01T12:15:00Z",
		}).expect(200);

		expect(
			(partial.body as AnalyticsSnapshot).series.map(
				row => row.traceCount,
			),
		).toEqual([0, 1, 1]);

		reconcile(partial.body);

		await post({ workflow: "literal%_\\path" }).expect(201);

		const selections: Array<Record<string, string>> = [
			{ q: "SUPPORT" },
			{ provider: " FIXTURE-A ", workflow: "batch" },
			{ model: "DEMO-FAST", status: "SUCCESS" },
			{ status: "ERROR", workflow: "support" },
			{ workflow: "Support" },
			{ q: "%_\\" },
			{ q: "' OR 1=1 --" },
		];

		for (const selection of selections) {
			const snapshot = (
				await get(selection).expect(200)
			).body as AnalyticsSnapshot;

			const list = await request(app.getHttpServer())
				.get(base + "/traces")
				.set("Authorization", bearer())
				.query({
					...windowQuery,
					...selection,
					pageSize: "100",
				})
				.expect(200);

			expect(snapshot.summary.traceCount).toBe(list.body.total);

			const items = list.body.items as Array<{
				inputTokens: number;
			}>;

			expect(snapshot.summary.inputTokens).toBe(
				items.reduce(
					(sum, row) => sum + BigInt(row.inputTokens),
					0n,
				).toString(),
			);

			reconcile(snapshot);
		}
	});

	it("aggregates beyond one page with exact large token totals", async () => {
		const original = await db.trace.findUniqueOrThrow({
			where: { id: traceIds[0] },
		});

		// Direct guarded fixture insertion avoids ingestion quotas here.
		await db.trace.createMany({
			data: Array.from({ length: 101 }, (_, index) => ({
				...original,
				id: randomUUID(),
				externalId: `large-${index}`,
				metadata: {},
				workflow: "large",
				inputTokens: 1_000_000_000,
				outputTokens: 1_000_000_000,
				inputCostUsd: "1000",
				outputCostUsd: "4000",
				estimatedCostUsd: "5000",
			})),
		});

		const { body } = await get({ workflow: "large" }).expect(200);

		expect(body.summary).toMatchObject({
			traceCount: 101,
			inputTokens: "101000000000",
			outputTokens: "101000000000",
			totalTokens: "202000000000",
			estimatedCostUsd: "505000.000000000000",
		});

		reconcile(body);
	});

	it("rounds rates and latency half-up in SQL", async () => {
		const original = await db.trace.findUniqueOrThrow({
			where: { id: traceIds[0] },
		});

		await db.trace.createMany({
			data: Array.from({ length: 32 }, (_, index) => ({
				...original,
				id: randomUUID(),
				externalId: `round-rate-${index}`,
				metadata: {},
				workflow: "round-rate",
				status: index === 0 ? "ERROR" : "SUCCESS",
			})),
		});

		expect(
			(await get({ workflow: "round-rate" }).expect(200))
				.body.summary.errorRatePct,
		).toBe(3.13);

		await db.trace.createMany({
			data: Array.from({ length: 2000 }, (_, index) => ({
				...original,
				id: randomUUID(),
				externalId: `round-latency-${index}`,
				metadata: {},
				workflow: "round-latency",
				latencyMs: index === 0 ? 1 : 0,
			})),
		});

		expect(
			(await get({ workflow: "round-latency" }).expect(200))
				.body.summary.averageLatencyMs,
		).toBe(0.001);
	});

	it("keeps providers separate and orders groups by numeric cost then provider/model", async () => {
		const definitions = [
			{
				provider: "fixture-a",
				model: "shared",
				inputUsdPerMillion: "1",
			},
			{
				provider: "fixture-b",
				model: "shared",
				inputUsdPerMillion: "1",
			},
			{
				provider: "fixture-a",
				model: "expensive",
				inputUsdPerMillion: "10",
			},
		];

		await pricing.loadCatalogue(
			definitions.map(value => ({
				...prices[0],
				...value,
				id: randomUUID(),
				outputUsdPerMillion: "0",
			})),
		);

		for (const value of definitions.slice().reverse()) {
			await post({
				provider: value.provider,
				model: value.model,
				workflow: "ordering",
				inputTokens: 1_000_000,
				outputTokens: 0,
			}).expect(201);
		}

		const { body } = await get({
			workflow: "ordering",
		}).expect(200);

		expect(body.byModel.map(
			(row: { provider: string; model: string }) =>
				`${row.provider}/${row.model}`,
		)).toEqual([
			"fixture-a/expensive",
			"fixture-a/shared",
			"fixture-b/shared",
		]);

		expect(body.summary.estimatedCostUsd)
			.toBe("12.000000000000");

		reconcile(body);
	});

	it("preserves historical costs and uses associated prices, not the newest catalogue entry", async () => {
		const tracesBefore = await db.trace.findMany({
			orderBy: { id: "asc" },
		});

		const projectBefore = await db.project.findUnique({
			where: { id: project },
		});

		await pricing.loadCatalogue([{
			...prices[0],
			id: randomUUID(),
			effectiveFrom: "2026-10-01T09:00:00Z",
			inputUsdPerMillion: "900",
			outputUsdPerMillion: "900",
			isSynthetic: false,
			sourceUrl: "https://example.com/pricing",
		}]);

		const pricesBefore = await db.modelPrice.findMany({
			orderBy: { id: "asc" },
		});

		const result = await internal();

		expect(result.snapshot.summary).toEqual(expected.summary);
		expect(result.pricing.containsSyntheticPricing).toBe(true);

		expect(await db.trace.findMany({
			orderBy: { id: "asc" },
		})).toEqual(tracesBefore);

		expect(await db.modelPrice.findMany({
			orderBy: { id: "asc" },
		})).toEqual(pricesBefore);

		expect(await db.project.findUnique({
			where: { id: project },
		})).toEqual(projectBefore);
	});

	it("reflects real public corrections and deletions in subsequent snapshots", async () => {
		await request(app.getHttpServer())
			.put(`/api/v1/public/traces/${traceIds[0]}`)
			.set("X-API-Key", key)
			.set("If-Match", '"1"')
			.send({ ...golden[0].body, inputTokens: 2000 })
			.expect(200);

		const corrected = (await get().expect(200)).body;

		expect(corrected.summary.inputTokens).toBe("7000");
		expect(corrected.summary.estimatedCostUsd)
			.toBe("0.016350000000");
		reconcile(corrected);

		await request(app.getHttpServer())
			.delete(`/api/v1/public/traces/${traceIds[0]}`)
			.set("X-API-Key", key)
			.set("If-Match", '"2"')
			.expect(204);

		const deleted = (await get().expect(200)).body;

		expect(deleted.summary.traceCount).toBe(5);
		expect(deleted.summary.estimatedCostUsd)
			.toBe("0.013550000000");
		reconcile(deleted);
	});

	it("refreshes for matching inserts but not for out-of-scope inserts", async () => {
		const first = (await get().expect(200)).body;

		await post().expect(201);

		const second = (await get().expect(200)).body;
		expect(second.summary.traceCount)
			.toBe(first.summary.traceCount + 1);

		await post({
			occurredAt: "2026-10-02T00:00:00Z",
		}).expect(201);

		const third = (await get().expect(200)).body;

		expect(third.summary).toEqual(second.summary);
		expect(third.series).toEqual(second.series);
		expect(third.byModel).toEqual(second.byModel);
		expect(third.snapshotId).not.toBe(second.snapshotId);
	});

	it("keeps one snapshot when a write commits between summary and chart queries", async () => {
		const readSummary = queries.readSummary;

		jest.spyOn(queries, "readSummary")
			.mockImplementationOnce(async (tx, where) => {
				const summary = await readSummary(tx, where);

				// This write commits on another connection before the next SELECT.
				await post().expect(201);

				await db.project.update({
					where: { id: project },
					data: { description: "Changed concurrently" },
				});

				return summary;
			});

		const during = await internal();

		expect(during.snapshot.summary).toEqual(expected.summary);
		expect(during.project.description).toBe("Stored description");
		reconcile(during.snapshot);

		const after = await internal();

		expect(after.snapshot.summary.traceCount).toBe(7);
		expect(after.project.description).toBe("Changed concurrently");
		reconcile(after.snapshot);
	});

	it("uses the supplied transaction for access, metadata, pricing and all aggregates", async () => {
		const access = jest.spyOn(
			app.get(ProjectAccessService),
			"assertProjectAccess",
		);

		await db.$transaction(
			async tx => {
				await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Honolulu'`;

				await tx.project.update({
					where: { id: project },
					data: { description: "Visible only inside tx" },
				});

				await tx.modelPrice.updateMany({
					data: { isSynthetic: false },
				});

				// These writes remain uncommitted while analytics reads them.
				// Another connection would still see all six golden traces.
				await tx.trace.update({
					where: { id: traceIds[0] },
					data: { deletedAt: new Date() },
				});

				// Do not spy on db.$queryRaw:
				// Prisma also exposes that method through the transaction proxy.
				const nested = jest
					.spyOn(db, "$transaction")
					.mockImplementation(() => {
						throw new Error("Nested transaction must not be opened");
					});

				try {
					const result = await analytics.readSnapshotInTransaction(
						tx,
						scope,
						parseAnalyticsQuery(windowQuery),
					);

					expect(access.mock.calls.at(-1)?.[4]).toBe(tx);

					expect(result.project.description).toBe(
						"Visible only inside tx",
					);

					expect(result.pricing.containsSyntheticPricing).toBe(false);

					// The first golden trace is excluded inside this transaction.
					expect(result.snapshot.summary).toEqual({
						traceCount: 5,
						inputTokens: "5000",
						outputTokens: "1000",
						totalTokens: "6000",
						estimatedCostUsd: "0.013550000000",
						errorCount: 2,
						errorRatePct: 40,
						averageLatencyMs: 2000,
					});

					// Its hourly bucket must also reflect the uncommitted deletion.
					expect(result.snapshot.series).toEqual(
						expected.series.map(row =>
							row.bucketStart === "2026-10-01T10:00:00.000Z"
								? {
									...row,
									traceCount: 0,
									inputTokens: "0",
									outputTokens: "0",
									estimatedCostUsd: "0.000000000000",
								}
								: row,
						),
					);

					// Its model group must reflect the same deletion.
					expect(result.snapshot.byModel).toEqual(
						expected.byModel.map(row =>
							row.provider === "fixture-a" && row.model === "demo-fast"
								? {
									...row,
									traceCount: 2,
									inputTokens: "2500",
									outputTokens: "600",
									estimatedCostUsd: "0.005350000000",
								}
								: row,
						),
					);

					reconcile(result.snapshot);
					expect(nested).not.toHaveBeenCalled();
				} finally {
					nested.mockRestore();
				}
			},
			{
				isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
			},
		);
	});

	it("propagates database failure instead of returning empty analytics", async () => {
		jest.spyOn(queries, "readSummary")
			.mockRejectedValueOnce(
				new Error("private database diagnostic"),
			);

		const response = await get().expect(500);

		expect(response.body.code).toBe("INTERNAL_SERVER_ERROR");
		expect(response.text).not.toContain("private database");
	});
});
