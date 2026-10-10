import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");

import { AppModule } from "../../src/app.module";
import { ApiKeysModule } from "../../src/api-keys/api-keys.module";
import { ApiKeysService } from "../../src/api-keys/api-keys.service";
import { ApiKeyAuthService } from "../../src/api-keys/api-key-auth.service";
import { ApiException } from "../../src/common/errors/api.exception";
import { ClientIpService } from "../../src/common/rate-limit/client-ip.service";
import { RateLimitClock } from "../../src/common/rate-limit/rate-limit.service";
import { PrismaService } from "../../src/database/prisma.service";
import { TokenService } from "../../src/auth/token.service";
import { configureApp } from "../../src/configure-app";
import { ApiKeyProbeController } from "../support/api-key-probe.controller";
import { generateApiKeySecret } from "../../src/api-keys/api-key-secret";

describe("API-key HTTP contract", () => {
	let app: INestApplication;
	let bearer: string;
	let now = 0;
	let ip = "192.0.2.1";

	const organizationId = randomUUID();
	const projectId = randomUUID();
	const keyId = randomUUID();
	const key = generateApiKeySecret().key;
	const base =
		`/api/v1/organizations/${organizationId}` +
		`/projects/${projectId}/api-keys`;
	const probe = "/api/v1/__test/api-key";

	const summary = {
		id: keyId,
		projectId,
		name: "Writer",
		keyPrefix: key.slice(0, 12),
		createdAt: "2026-10-01T00:00:00.000Z",
		lastUsedAt: null,
		revokedAt: null,
	};

	const management = {
		create: jest.fn(),
		list: jest.fn(),
		revoke: jest.fn(),
	};

	const auth = {
		authenticate: jest.fn(),
		recordSuccessfulUse: jest.fn(),
	};

	beforeAll(async () => {
		const context = await Test.createTestingModule({
			imports: [AppModule, ApiKeysModule],
			controllers: [ApiKeyProbeController],
		})
			.overrideProvider(PrismaService).useValue({})
			.overrideProvider(ApiKeysService).useValue(management)
			.overrideProvider(ApiKeyAuthService).useValue(auth)
			.overrideProvider(ClientIpService)
			.useValue({ getClientIp: async () => ip })
			.overrideProvider(RateLimitClock)
			.useValue({ now: () => now })
			.compile();

		app = context.createNestApplication({ logger: false });
		configureApp(app);
		await app.init();

		bearer = "Bearer " +
			app.get(TokenService).signAccessToken(randomUUID()).accessToken;
	});

	beforeEach(() => {
		now += 60_001;
		ip = "192.0.2.1";

		Object.values(management).forEach(mock => mock.mockReset());
		Object.values(auth).forEach(mock => mock.mockReset());

		management.create.mockResolvedValue({ ...summary, key });
		management.list.mockResolvedValue([summary]);
		management.revoke.mockResolvedValue(undefined);

		auth.authenticate.mockImplementation(async (submitted: string) => {
			if (submitted !== key) {
				throw new ApiException(
					401,
					"INVALID_API_KEY",
					"The provided API key is invalid.",
				);
			}
			return { keyId, projectId };
		});
		auth.recordSuccessfulUse.mockResolvedValue(undefined);
	});

	afterAll(async () => { await app?.close(); });

	it("creates with normalized input, no-store and a request ID", async () => {
		const response = await request(app.getHttpServer())
			.post(base)
			.set("Authorization", bearer)
			.set("X-Request-Id", "tse67-create")
			.send({ name: "  Writer  " })
			.expect(201)
			.expect("Cache-Control", "no-store")
			.expect("X-Request-Id", "tse67-create");

		expect(response.body).toEqual({ ...summary, key });
		expect(management.create).toHaveBeenCalledWith(
			expect.any(String),
			organizationId,
			projectId,
			expect.objectContaining({ name: "Writer" }),
		);
	});

	it("lists safe metadata and supports an empty array", async () => {
		await request(app.getHttpServer())
			.get(base).set("Authorization", bearer)
			.expect(200).expect("Cache-Control", "no-store")
			.expect([summary]);

		management.list.mockResolvedValueOnce([]);

		await request(app.getHttpServer())
			.get(base).set("Authorization", bearer)
			.expect(200).expect([]);
	});

	it("revokes with an empty 204 response", async () => {
		const response = await request(app.getHttpServer())
			.delete(`${base}/${keyId}`)
			.set("Authorization", bearer)
			.expect(204);

		expect(response.text).toBe("");
	});

	it.each([
		{},
		{ name: "" },
		{ name: "   " },
		{ name: 42 },
		{ name: "x".repeat(65) },
		{ name: "Writer", projectId },
		{ name: "Writer", key: "injected" },
		{ name: "Writer", role: "OWNER" },
	])("rejects invalid creation input %j", async body => {
		const response = await request(app.getHttpServer())
			.post(base).set("Authorization", bearer)
			.send(body).expect(400);

		expect(response.body.code).toBe("VALIDATION_ERROR");
		expect(management.create).not.toHaveBeenCalled();
	});

	it("validates all management route IDs", async () => {
		const paths = [
			base.replace(organizationId, "invalid"),
			base.replace(projectId, "invalid"),
		];

		for (const path of paths) {
			await request(app.getHttpServer())
				.get(path).set("Authorization", bearer).expect(400);
		}

		await request(app.getHttpServer())
			.delete(`${base}/invalid`)
			.set("Authorization", bearer).expect(400);
	});

	it("does not accept an API key on JWT management routes", async () => {
		for (const method of ["get", "post", "delete"] as const) {
			const path = method === "delete" ? `${base}/${keyId}` : base;
			const call = request(app.getHttpServer())[method](path)
				.set("X-API-Key", key);

			if (method === "post") call.send({ name: "Writer" });

			await call.expect(401);
		}
	});

	it("returns the trusted principal on the public test route", async () => {
		await request(app.getHttpServer())
			.get(probe)
			.set("X-API-Key", key)
			.expect(200)
			.expect({ keyId, projectId });
	});

	it("rejects JWT-only and repeated API-key headers", async () => {
		await request(app.getHttpServer())
			.get(probe).set("Authorization", bearer).expect(401);

		await request(app.getHttpServer())
			.get(probe).set({"X-API-Key": [key, key]}).expect(401);
	});

	it("limits invalid credentials before further authentication", async () => {
		for (let i = 0; i < 60; i += 1) {
			await request(app.getHttpServer())
				.get(probe).set("X-API-Key", "bad").expect(401);
		}

		const calls = auth.authenticate.mock.calls.length;

		const response = await request(app.getHttpServer())
			.get(probe).set("X-API-Key", key).expect(429);

		expect(response.body.code).toBe("RATE_LIMITED");
		expect(response.headers["retry-after"]).toBe("60");
		expect(auth.authenticate).toHaveBeenCalledTimes(calls);
	});

	it("shares key quota across methods and multiple trusted IPs", async () => {
		for (let i = 0; i < 120; i += 1) {
			ip = `192.0.2.${Math.floor(i / 40) + 1}`;

			if (i % 2 === 0) {
				await request(app.getHttpServer())
					.get(probe).set("X-API-Key", key).expect(200);
			} else {
				await request(app.getHttpServer())
					.post(probe).set("X-API-Key", key)
					.send({ value: "ok" }).expect(201);
			}
		}

		ip = "192.0.2.10";

		await request(app.getHttpServer())
			.get(probe).set("X-API-Key", key)
			.expect(429).expect("Retry-After", "60");
	});

	it("counts requests whose DTO validation later fails", async () => {
		for (let i = 0; i < 60; i += 1) {
			await request(app.getHttpServer())
				.post(probe).set("X-API-Key", key)
				.send({}).expect(400);
		}

		await request(app.getHttpServer())
			.get(probe).set("X-API-Key", key).expect(429);
	});

	it("preserves safe errors and request IDs", async () => {
		management.list.mockRejectedValueOnce(
			new Error("DO_NOT_EXPOSE_SECRET"),
		);

		const response = await request(app.getHttpServer())
			.get(base).set("Authorization", bearer)
			.set("X-Request-Id", "tse67-error")
			.expect(500);

		expect(response.body).toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			requestId: "tse67-error",
		});
		expect(response.text).not.toContain("DO_NOT_EXPOSE_SECRET");
	});
});
