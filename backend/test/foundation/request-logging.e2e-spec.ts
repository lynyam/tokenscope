import "reflect-metadata";
import { Controller, Get, HttpStatus, Post } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { isUUID } from "class-validator";
import request = require("supertest");
import { ApiException } from "../../src/common/errors/api.exception";
import { configureApp } from "../../src/configure-app";

const SECRET = "DO_NOT_LOG_SENSITIVE_VALUE";
const PROJECT_ID = "8e32b232-eeda-4c5e-bbf0-427e799ff076";

@Controller("logging-probe")
class LoggingProbeController {
	@Get()
	healthy() {
		return { status: "healthy" };
	}

	@Post("projects/:projectId/:label")
	accept() {
		return { accepted: true };
	}

	@Get("unexpected")
	unexpected() {
		throw new Error(SECRET);
	}

	@Get("prisma-error")
	prismaError() {
		throw Object.assign(new Error("SELECT passwordHash FROM User " + SECRET), {
			code: "P2002",
		});
	}

	@Get("dependency")
	dependency() {
		throw new ApiException(
			HttpStatus.SERVICE_UNAVAILABLE,
			"DATABASE_UNAVAILABLE",
			"Database is unavailable.",
		);
	}
}

describe("Request logging and error privacy", () => {
	let app: INestApplication;
	const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

	function events(output: jest.Mock, event: string) {
		return output.mock.calls
			.map(([message]) => JSON.parse(String(message)) as Record<string, unknown>)
			.filter((entry) => entry.event === event);
	}

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			controllers: [LoggingProbeController],
		}).setLogger(logger).compile();

		app = moduleRef.createNestApplication({ logger });
		configureApp(app);
		await app.init();
	});

	beforeEach(() => {
		jest.clearAllMocks();
	});

	afterEach(() => {
		const output = JSON.stringify([
			logger.log.mock.calls,
			logger.warn.mock.calls,
			logger.error.mock.calls,
		]);
		expect(output).not.toContain(SECRET);
		expect(output).not.toContain("P2002");
		expect(output).not.toContain("SELECT passwordHash");
	});

	afterAll(async () => {
		await app?.close();
	});

	it("logs one completed response with its final status and request ID", async () => {
		await request(app.getHttpServer())
		.get("/api/v1/logging-probe")
		.set("X-Request-Id", "logging-success")
		.expect("X-Request-Id", "logging-success")
		.expect(200);

		const completed = events(logger.log, "request_completed");
		expect(completed).toEqual([{
			event: "request_completed",
			requestId: "logging-success",
			method: "GET",
			route: "/api/v1/logging-probe",
			statusCode: 200,
			durationMs: expect.any(Number),
		}]);
		expect(completed[0].durationMs).toBeGreaterThanOrEqual(0);
		expect(logger.warn).not.toHaveBeenCalled();
		expect(logger.error).not.toHaveBeenCalled();
	});

	it("logs only the route template and allowed UUIDs for a sensitive request", async () => {
		await request(app.getHttpServer())
			.post(`/api/v1/logging-probe/projects/${PROJECT_ID}/${SECRET}`)
			.query({ token: SECRET })
			.set("X-Request-Id", "logging-private")
			.set("Authorization", "Bearer " + SECRET)
			.send({ password: SECRET, passwordHash: SECRET, accessToken: SECRET })
			.expect(201);

		expect(events(logger.log, "request_completed")).toEqual([{
			event: "request_completed",
			requestId: "logging-private",
			method: "POST",
			route: "/api/v1/logging-probe/projects/:projectId/:label",
			resourceIds: { projectId: PROJECT_ID },
			statusCode: 201,
			durationMs: expect.any(Number),
		}]);
	});

	it("omits malformed resource IDs from logs", async () => {
		await request(app.getHttpServer())
			.post(`/api/v1/logging-probe/projects/${SECRET}/label`)
			.send({})
			.expect(201);

		expect(events(logger.log, "request_completed")[0])
			.not.toHaveProperty("resourceIds");
	});

	it("correlates a concealed unknown route without logging the requested URL", async () => {
		const response = await request(app.getHttpServer())
			.get("/api/v1/missing/" + SECRET)
			.set("X-Request-Id", "logging-missing")
			.expect(404);

		expect(response.body).toEqual({
			statusCode: 404,
			code: "NOT_FOUND",
			error: "Not Found",
			message: "The requested resource was not found.",
			requestId: "logging-missing",
		});
		expect(response.headers["x-request-id"]).toBe("logging-missing");
		expect(events(logger.warn, "request_failed")).toEqual([{
			event: "request_failed",
			requestId: "logging-missing",
			method: "GET",
			route: "<unmatched>",
			statusCode: 404,
			code: "NOT_FOUND",
		}]);
		expect(events(logger.log, "request_completed")).toEqual([
			expect.objectContaining({ requestId: "logging-missing", statusCode: 404 }),
		]);
	});

	it.each(["unexpected", "prisma-error"])("safely handles %s", async (path) => {
		const response = await request(app.getHttpServer())
			.get("/api/v1/logging-probe/" + path)
			.set("X-Request-Id", "logging-error")
			.expect(500);

		expect(response.body).toEqual({
			statusCode: 500,
			code: "INTERNAL_SERVER_ERROR",
			error: "Internal Server Error",
			message: "An unexpected error occurred.",
			requestId: "logging-error",
		});
		expect(response.headers["x-request-id"]).toBe("logging-error");
		expect(events(logger.error, "request_failed")).toEqual([
			expect.objectContaining({
				requestId: "logging-error", statusCode: 500, code: "INTERNAL_SERVER_ERROR",
			}),
		]);
		expect(events(logger.log, "request_completed")).toEqual([
			expect.objectContaining({ requestId: "logging-error", statusCode: 500 }),
		]);
	});

	it("keeps a deliberate dependency failure at 503", async () => {
		const response = await request(app.getHttpServer())
			.get("/api/v1/logging-probe/dependency")
			.expect(503);

		expect(response.body.code).toBe("DATABASE_UNAVAILABLE");
		expect(response.body.requestId).toBe(response.headers["x-request-id"]);
		expect(events(logger.error, "request_failed")).toEqual([
			expect.objectContaining({ statusCode: 503, code: "DATABASE_UNAVAILABLE" }),
		]);
		expect(events(logger.log, "request_completed")).toEqual([
			expect.objectContaining({ statusCode: 503 }),
		]);
	});

	it("logs malformed JSON safely even before routing and DTO validation", async () => {
		const response = await request(app.getHttpServer())
			.post(`/api/v1/logging-probe/projects/${PROJECT_ID}/label`)
			.set("Content-Type", "application/json")
			.send('{"password":"' + SECRET + '"')
			.expect(400);

		expect(response.body.code).toBe("VALIDATION_ERROR");
		expect(response.body.requestId).toBe(response.headers["x-request-id"]);
		expect(response.text).not.toContain(SECRET);
		expect(events(logger.log, "request_completed")).toEqual([
			expect.objectContaining({ route: "<unmatched>", statusCode: 400 }),
		]);
	});

	it.each([
		{ label: "missing", value: undefined },
		{ label: "invalid", value: "bad\\id" },
		{ label: "overlong", value: "x".repeat(129) },
		{ label: "duplicate", value: ["first", "second"] },
	])("generates a request ID for a $label header", async ({ value }) => {
		const call = request(app.getHttpServer()).get("/api/v1/logging-probe");
		if (value !== undefined) call.set({ "X-Request-Id": value });
		const response = await call.expect(200);
		const requestId = response.headers["x-request-id"];

		expect(isUUID(requestId, "4")).toBe(true);
		expect(events(logger.log, "request_completed")).toEqual([
			expect.objectContaining({ requestId, statusCode: 200 }),
		]);
	});
});
