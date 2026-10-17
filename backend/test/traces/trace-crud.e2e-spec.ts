import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/configure-app";
import { PrismaService } from "../../src/database/prisma.service";
import { ApiKeyAuthService } from "../../src/api-keys/api-key-auth.service";
import { TracesService } from "../../src/traces/traces.service";
import { TraceReadsService } from "../../src/traces/trace-reads.service";
import { ClientIpService } from "../../src/common/rate-limit/client-ip.service";
import { RateLimitClock } from "../../src/common/rate-limit/rate-limit.service";
import { TokenService } from "../../src/auth/token.service";

const payload = {
	externalId: "http-replace",
	provider: "fixture-a",
	model: "demo-fast",
	workflow: "support",
	inputTokens: 1000,
	outputTokens: 200,
	latencyMs: 500,
	status: "SUCCESS",
	occurredAt: "2026-10-01T10:00:00Z",
};

describe("Trace CRUD HTTP contracts", () => {
	let app: INestApplication;
	let tokens: TokenService;
	let now = 0;

	const traceId = randomUUID();
	const organizationId = randomUUID();
	const projectId = randomUUID();

	const replace = jest.fn();
	const remove = jest.fn();
	const listPublic = jest.fn();
	const detailPublic = jest.fn();
	const listBrowser = jest.fn();
	const detailBrowser = jest.fn();

	beforeAll(async () => {
		const module = await Test.createTestingModule({
			imports: [AppModule],
		})
			.overrideProvider(PrismaService).useValue({})
			.overrideProvider(ApiKeyAuthService).useValue({
				authenticate: jest.fn().mockResolvedValue({
					keyId: randomUUID(),
					projectId,
				}),
				recordSuccessfulUse: jest.fn().mockResolvedValue(undefined),
			})
			.overrideProvider(TracesService).useValue({
				ingest: jest.fn(),
				replace,
				remove,
			})
			.overrideProvider(TraceReadsService).useValue({
				listPublic,
				detailPublic,
				listBrowser,
				detailBrowser,
			})
			.overrideProvider(ClientIpService).useValue({
				getClientIp: async () => "127.0.0.1",
			})
			.overrideProvider(RateLimitClock).useValue({ now: () => now })
			.compile();

		app = module.createNestApplication({ logger: false, rawBody: true });
		configureApp(app);
		await app.init();
		tokens = app.get(TokenService);
	});

	beforeEach(() => {
		now += 60_001;
		jest.clearAllMocks();

		replace.mockResolvedValue({ id: traceId, version: 2 });
		remove.mockResolvedValue(undefined);
		detailPublic.mockResolvedValue({ id: traceId, version: 1 });

		const page = {
			items: [],
			page: 1,
			pageSize: 25,
			total: 0,
			totalPages: 0,
		};

		listPublic.mockResolvedValue(page);
		listBrowser.mockResolvedValue(page);
		detailBrowser.mockResolvedValue({ id: traceId, version: 1 });
	});

	afterAll(async () => { await app?.close(); });

	it("returns detail ETag and replacement ETag", async () => {
		await request(app.getHttpServer())
			.get(`/api/v1/public/traces/${traceId}`)
			.set("X-API-Key", "test-key")
			.expect(200)
			.expect("ETag", '"1"');

		await request(app.getHttpServer())
			.put(`/api/v1/public/traces/${traceId}`)
			.set("X-API-Key", "test-key")
			.set("If-Match", '"1"')
			.send(payload)
			.expect(200)
			.expect("ETag", '"2"');

		expect(replace.mock.calls[0][3]).toMatchObject({
			occurredAt: "2026-10-01T10:00:00.000Z",
			metadata: {},
		});
	});

	it("returns an empty 204 for DELETE", async () => {
		const result = await request(app.getHttpServer())
			.delete(`/api/v1/public/traces/${traceId}`)
			.set("X-API-Key", "test-key")
			.set("If-Match", '"1"')
			.expect(204);

		expect(result.text).toBe("");
	});

	it("rejects unknown and repeated query parameters", async () => {
		for (const query of ["includeDeleted=true", "page=1&page=2"]) {
			await request(app.getHttpServer())
				.get(`/api/v1/public/traces?${query}`)
				.set("X-API-Key", "test-key")
				.expect(400);
		}

		expect(listPublic).not.toHaveBeenCalled();
	});

	it("reuses replacement validation and actual body limits", async () => {
		await request(app.getHttpServer())
			.put(`/api/v1/public/traces/${traceId}`)
			.set("X-API-Key", "test-key")
			.set("If-Match", '"1"')
			.send({ ...payload, version: 99 })
			.expect(400);

		await request(app.getHttpServer())
			.put(`/api/v1/public/traces/${traceId}`)
			.set("X-API-Key", "test-key")
			.set("Content-Type", "application/json")
			.set("If-Match", '"1"')
			.send(" ".repeat(16384) + JSON.stringify(payload))
			.expect(413);

		expect(replace).not.toHaveBeenCalled();
	});

	it("keeps JWT and API-key authentication separate", async () => {
		const bearer =
			"Bearer " + tokens.signAccessToken(randomUUID()).accessToken;

		await request(app.getHttpServer())
			.get("/api/v1/public/traces")
			.set("Authorization", bearer)
			.expect(401);

		const path =
			`/api/v1/organizations/${organizationId}/projects/${projectId}/traces`;

		await request(app.getHttpServer())
			.get(path)
			.set("X-API-Key", "test-key")
			.expect(401);

		await request(app.getHttpServer())
			.get(path)
			.set("Authorization", bearer)
			.expect(200);
	});

	it("serves the specification and local Swagger assets publicly", async () => {
		const result = await request(app.getHttpServer())
			.get("/api/v1/public/openapi.json")
			.expect(200);

		expect(result.body.openapi).toBe("3.1.2");
		expect(result.body.paths["/public/traces"].post).toBeDefined();
		expect(result.body.paths["/public/traces/{traceId}"].delete).toBeDefined();

		await request(app.getHttpServer())
			.get("/api/v1/public/docs/")
			.expect(200);

		await request(app.getHttpServer())
			.get("/api/v1/public/docs/swagger-ui.css")
			.expect(200);
	});
});