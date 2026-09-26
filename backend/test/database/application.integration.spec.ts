import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { AppModule } from "../../src/app.module";
import type { EnvironmentVariables } from "../../src/config/env.validation";
import { configureApp } from "../../src/configure-app";
import { DatabaseModule } from "../../src/database/database.module";
import { PrismaService } from "../../src/database/prisma.service";

describe("Application with PostgreSQL", () => {
  it("boots with validated configuration, serves health, and disconnects Prisma", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);

    const prisma = app.get(PrismaService);
    const connect = jest.spyOn(prisma, "$connect");
    const disconnect = jest.spyOn(prisma, "$disconnect");

    try {
      await app.init();

      const config = app.get(ConfigService<EnvironmentVariables>);
      expect(config.getOrThrow("BACKEND_PORT", { infer: true })).toBe(3000);
      expect(config.getOrThrow("JWT_ACCESS_TTL_SECONDS", { infer: true })).toBe(3600);
      expect(connect).toHaveBeenCalledTimes(1);
      expect(app.select(DatabaseModule).get(PrismaService, { strict: true })).toBe(prisma);

      await request(app.getHttpServer())
        .get("/api/v1/health")
        .expect(200)
        .expect({ status: "healthy" });

      await request(app.getHttpServer())
        .get("/api/v1/health/db")
        .set("X-Request-Id", "postgres-readiness")
        .expect("X-Request-Id", "postgres-readiness")
        .expect(200)
        .expect({ status: "healthy" });
    } finally {
      await app.close();
    }

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
