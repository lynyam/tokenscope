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
import { PricingService } from "../../src/pricing/pricing.service";
import { TokenService } from "../../src/auth/token.service";
import { ClientIpService } from "../../src/common/rate-limit/client-ip.service";
import { RateLimitClock } from "../../src/common/rate-limit/rate-limit.service";

const body = {
	externalId: "http-1",
	provider: "fixture-a",
	model: "demo-fast",
	workflow: "support",
	inputTokens: 1000,
	outputTokens: 200,
	latencyMs: 0,
	status: "SUCCESS",
	occurredAt: "2026-10-01T10:00:00Z",
};

describe("Trace and pricing HTTP contracts", () => {
	let app: INestApplication;
	let tokens: TokenService;
	let now = 0;

	const ingest = jest.fn();
	const list = jest.fn();

	const send = (value: string | object = body) =>
		request(app.getHttpServer())
			.post("/api/v1/public/traces")
			.set("X-API-Key", "test-key")
			.send(value);

	beforeAll(async () => {
		const context = await Test.createTestingModule({
			imports: [AppModule],
		})
			.overrideProvider(PrismaService).useValue({})
			.overrideProvider(ApiKeyAuthService).useValue({
				authenticate: jest.fn().mockResolvedValue({
					keyId: "key",
					projectId: "project",
				}),
				recordSuccessfulUse: jest.fn().mockResolvedValue(undefined),
			})
			.overrideProvider(TracesService).useValue({ ingest })
			.overrideProvider(PricingService).useValue({ list })
			.overrideProvider(ClientIpService).useValue({
				getClientIp: async () => "127.0.0.1",
			})
			.overrideProvider(RateLimitClock).useValue({ now: () => now })
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
		jest.clearAllMocks();
		ingest.mockResolvedValue({
			created: true,
			trace: { id: "trace", version: 1 },
		});
		list.mockResolvedValue([]);
	});

	afterAll(async () => { await app?.close(); });

	it("returns 201 for creation and 200 for replay with ETag", async () => {
		await send().expect(201).expect("ETag", '"1"');

		ingest.mockResolvedValueOnce({
			created: false,
			trace: { id: "trace", version: 2 },
		});

		await send().expect(200).expect("ETag", '"2"');

		expect(ingest.mock.calls[0][1]).toMatchObject({
			occurredAt: "2026-10-01T10:00:00.000Z",
			metadata: {},
		});
	});

	it.each([
		{ projectId: "override" },
		{ inputTokens: "1000" },
		{ inputTokens: 1.2 },
		{ inputTokens: -1 },
		{ metadata: null },
		{ metadata: { nested: {} } },
		{ metadata: { value: "a".repeat(401) } },
	])("rejects invalid input before the service: %j", async patch => {
		const response = await send({ ...body, ...patch }).expect(400);

		expect(response.body.code).toBe("VALIDATION_ERROR");
		expect(response.body.requestId).toBeTruthy();
		expect(ingest).not.toHaveBeenCalled();
	});

	it("rejects actual multibyte bodies larger than 16 KiB", async () => {
		const text = JSON.stringify({
			...body,
			extra: "界".repeat(6000),
		});

		expect(text.length).toBeLessThan(16_384);
		expect(Buffer.byteLength(text)).toBeGreaterThan(16_384);

		const response = await request(app.getHttpServer())
			.post("/api/v1/public/traces")
			.set("X-API-Key", "test-key")
			.set("Content-Type", "application/json")
			.send(text)
			.expect(413);

		expect(response.body.code).toBe("PAYLOAD_TOO_LARGE");
		expect(ingest).not.toHaveBeenCalled();
	});

	it("counts JSON whitespace in the actual byte limit", async () => {
		await request(app.getHttpServer())
			.post("/api/v1/public/traces")
			.set("X-API-Key", "test-key")
			.set("Content-Type", "application/json")
			.send(" ".repeat(16_384) + JSON.stringify(body))
			.expect(413);

		expect(ingest).not.toHaveBeenCalled();
	});

	it("rejects unsupported content types", async () => {
		const response = await request(app.getHttpServer())
			.post("/api/v1/public/traces")
			.set("X-API-Key", "test-key")
			.set("Content-Type", "text/plain")
			.send(JSON.stringify(body))
			.expect(415);

		expect(response.body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
		expect(ingest).not.toHaveBeenCalled();
	});

	it("does not authorize ingestion with JWT alone", async () => {
		await request(app.getHttpServer())
			.post("/api/v1/public/traces")
			.set("Authorization", "Bearer " + tokens.signAccessToken(randomUUID()).accessToken)
			.send(body)
			.expect(401);

		expect(ingest).not.toHaveBeenCalled();
	});

	it("requires JWT for catalogue access", async () => {
		await request(app.getHttpServer())
			.get("/api/v1/model-prices")
			.set("X-API-Key", "test-key")
			.expect(401);
	});

	it("normalizes catalogue filters and rejects unknown query fields", async () => {
		const bearer = "Bearer " + tokens.signAccessToken(randomUUID()).accessToken;

		await request(app.getHttpServer())
			.get("/api/v1/model-prices")
			.query({ provider: " FIXTURE-A ", model: " DEMO-FAST " })
			.set("Authorization", bearer)
			.expect(200);

		expect(list).toHaveBeenCalledWith({
			provider: "fixture-a",
			model: "demo-fast",
		});

		list.mockClear();

		await request(app.getHttpServer())
			.get("/api/v1/model-prices?unexpected=true")
			.set("Authorization", bearer)
			.expect(400);

		expect(list).not.toHaveBeenCalled();
	});
});
