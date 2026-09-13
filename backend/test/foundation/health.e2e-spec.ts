import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { configureApp } from "../../src/configure-app";
import { PrismaService } from "../../src/database/prisma.service";
import { HealthModule } from "../../src/health/health.module";

describe("Health HTTP contract", () => {
  let app: INestApplication;
  const prisma = { $queryRaw: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [HealthModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    prisma.$queryRaw.mockReset();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("serves public liveness without querying the database", async () => {
    prisma.$queryRaw.mockRejectedValue(new Error("Database unavailable"));

    await request(app.getHttpServer())
      .get("/api/v1/health")
      .expect(200)
      .expect({ status: "healthy" });

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("serves public readiness without returning query rows", async () => {
    prisma.$queryRaw.mockResolvedValue([{ privateValue: "DO_NOT_EXPOSE_QUERY_ROWS" }]);

    await request(app.getHttpServer())
      .get("/api/v1/health/db")
      .set("X-Request-Id", "health-ready")
      .expect("X-Request-Id", "health-ready")
      .expect(200)
      .expect({ status: "healthy" });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("maps a failed readiness query to a safe, correlated 503", async () => {
    prisma.$queryRaw.mockRejectedValue(new Error("DO_NOT_EXPOSE_DATABASE_ERROR"));

    await request(app.getHttpServer())
      .get("/api/v1/health/db")
      .set("X-Request-Id", "health-unavailable")
      .expect("X-Request-Id", "health-unavailable")
      .expect(503)
      .expect({
        statusCode: 503,
        code: "DATABASE_UNAVAILABLE",
        error: "Service Unavailable",
        message: "Database is unavailable.",
        requestId: "health-unavailable",
      });
  });

  it("checks readiness again after an earlier failure", async () => {
    prisma.$queryRaw
      .mockRejectedValueOnce(new Error("Database unavailable"))
      .mockResolvedValueOnce([{ result: 1 }]);

    await request(app.getHttpServer()).get("/api/v1/health/db").expect(503);
    await request(app.getHttpServer())
      .get("/api/v1/health/db")
      .expect(200)
      .expect({ status: "healthy" });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it.each(["/health", "/api/health"])("does not expose legacy alias %s", async (path) => {
    const response = await request(app.getHttpServer()).get(path).expect(404);
    expect(response.body.code).toBe("NOT_FOUND");
    expect(response.body.requestId).toBe(response.headers["x-request-id"]);
  });
});
