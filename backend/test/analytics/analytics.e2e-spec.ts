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
import { TokenService } from "../../src/auth/token.service";
import { AnalyticsService } from "../../src/analytics/analytics.service";
import { TraceReadsService } from "../../src/traces/trace-reads.service";
import { RateLimitClock } from "../../src/common/rate-limit/rate-limit.service";
import { ApiException } from "../../src/common/errors/api.exception";

const directory = existsSync("/fixtures/evaluation")
	? "/fixtures/evaluation"
	: resolve(process.cwd(), "../fixtures/evaluation");

const golden = JSON.parse(readFileSync(
	resolve(directory, "responses/analytics-golden.json"),
	"utf8",
));

describe("Analytics HTTP contract", () => {
	let app: INestApplication;
	let tokens: TokenService;
	let now = 0;

	const actorId = randomUUID();
	const organizationId = randomUUID();
	const projectId = randomUUID();

	const base =
		`/api/v1/organizations/${organizationId}/projects/${projectId}`;

	const getSnapshot = jest.fn();
	const listBrowser = jest.fn();
	const detailBrowser = jest.fn();

	const auth = () =>
		"Bearer " + tokens.signAccessToken(actorId).accessToken;

	const get = (suffix = "") =>
		request(app.getHttpServer())
			.get(base + "/analytics" + suffix)
			.set("Authorization", auth());

	beforeAll(async () => {
		const context = await Test.createTestingModule({
			imports: [AppModule],
		})
			.overrideProvider(PrismaService).useValue({})
			.overrideProvider(AnalyticsService).useValue({ getSnapshot })
			.overrideProvider(TraceReadsService).useValue({
				listBrowser,
				detailBrowser,
			})
			.overrideProvider(RateLimitClock).useValue({
				now: () => now,
			})
			.compile();

		app = context.createNestApplication({
			logger: false,
			rawBody: true,
		});

		configureApp(app);
		await app.init();

		tokens = app.get(TokenService);
	});

	beforeEach(() => {
		now += 60_001;
		jest.resetAllMocks();

		getSnapshot.mockResolvedValue({ ...golden, projectId });
		listBrowser.mockResolvedValue({ items: [], total: 0 });
		detailBrowser.mockResolvedValue({
			id: randomUUID(),
			version: 1,
		});
	});

	afterAll(async () => {
		await app?.close();
	});

	it("returns the direct snapshot with no-store and request ID", async () => {
		const response = await get()
			.query({
				from: golden.window.from,
				to: golden.window.to,
				bucket: "hour",
			})
			.expect(200)
			.expect("Cache-Control", "no-store");

		expect(response.body).toEqual({ ...golden, projectId });
		expect(response.headers["x-request-id"]).toBeTruthy();
		expect(response.body).not.toHaveProperty("project");
		expect(response.body).not.toHaveProperty("pricing");

		expect(getSnapshot).toHaveBeenCalledWith(
			{ actorId, organizationId, projectId },
			{
				filters: {
					from: new Date(golden.window.from),
					to: new Date(golden.window.to),
				},
				bucket: "hour",
			},
		);
	});

	it.each([
		"page=1",
		"sortBy=occurredAt",
		"actorId=x",
		"includeArchived=true",
		"bucket=hour&bucket=day",
		"q=a&q=b",
		"from=bad",
		"bucket=week",
	])("rejects %s before the service", async suffix => {
		const response = await get("?" + suffix).expect(400);

		expect(response.body.code).toBe("VALIDATION_ERROR");
		expect(response.body.requestId)
			.toBe(response.headers["x-request-id"]);
		expect(getSnapshot).not.toHaveBeenCalled();
	});

	it("rejects malformed UUIDs and API-key-only requests", async () => {
		await request(app.getHttpServer())
			.get(`/api/v1/organizations/bad/projects/${projectId}/analytics`)
			.set("Authorization", auth())
			.expect(400);

		await request(app.getHttpServer())
			.get(base + "/analytics")
			.expect(401);

		await request(app.getHttpServer())
			.get(base + "/analytics")
			.set("X-API-Key", "test-key")
			.expect(401);

		expect(getSnapshot).not.toHaveBeenCalled();
	});

	it("preserves not-found and safe server errors", async () => {
		getSnapshot.mockRejectedValueOnce(
			new ApiException(404, "PROJECT_NOT_FOUND", "Project not found."),
		);

		expect((await get().expect(404)).body.code)
			.toBe("PROJECT_NOT_FOUND");

		getSnapshot.mockRejectedValueOnce(
			new Error("private SQL diagnostic"),
		);

		const response = await get().expect(500);

		expect(response.body.code).toBe("INTERNAL_SERVER_ERROR");
		expect(response.text).not.toContain("private SQL");
	});

	it("shares one quota with trace list and detail", async () => {
		for (let index = 0; index < 58; index++) {
			await get().expect(200);
		}

		await request(app.getHttpServer())
			.get(base + "/traces")
			.set("Authorization", auth())
			.expect(200);

		await request(app.getHttpServer())
			.get(base + "/traces/" + randomUUID())
			.set("Authorization", auth())
			.expect(200);

		const response = await get().expect(429);

		expect(response.body.code).toBe("RATE_LIMITED");
		expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
		expect(getSnapshot).toHaveBeenCalledTimes(58);

		now += 60_001;
		await get().expect(200);
	});
});
