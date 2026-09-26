/**
 * TEST FILE — end-to-end
 * Suite:  npm run test:e2e   (config: test/jest-e2e.json)
 * Scope:  The REAL AppModule + configureApp, over real HTTP.
 *         Proves the wiring unit tests cannot: /api/v1 prefix applied,
 *         JwtAuthGuard globally active, ValidationPipe rejecting unknown
 *         fields, and ApiExceptionFilter turning thrown ApiExceptions
 *         into API.md's documented error envelope — INCLUDING the
 *         request-id response header the filter always sets.
 *
 * Database: PrismaService is substituted with an in-memory fake, so this
 *           suite runs without a real PostgreSQL connection. Real
 *           database constraints (the email unique index) are proved in
 *           test/database/auth.integration.spec.ts instead.
 */
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/configure-app";
import { PrismaService } from "../../src/database/prisma.service";
import { REQUEST_ID_HEADER } from "../../src/common/constants/http.constants";
import request = require("supertest");
import { randomUUID } from "node:crypto";
import { sign } from "jsonwebtoken";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../../src/config/env.validation";

describe("Auth (e2e)", () => {
  let app: INestApplication;

  const users: Record<string, unknown>[] = [];

  const prismaMock = {
    user: {
      findUnique: jest.fn(({ where }: { where: Record<string, string> }) => {
        if (where.email) return users.find((u) => u.email === where.email) ?? null;
        if (where.id) return users.find((u) => u.id === where.id) ?? null;
        return null;
      }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        // Match the identity contract enforced by the real TokenService.
        const user = { id: randomUUID(), ...data };
        users.push(user);
        return user;
      }),
    },
    membership: { findFirst: jest.fn(), findMany: jest.fn() },
    organization: { findMany: jest.fn(), findFirst: jest.fn() },
    project: { findFirst: jest.fn(), findMany: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ result: 1 }]),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };

  const signUpPayload = {
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

      app = moduleFixture.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    users.length = 0;
    jest.clearAllMocks();
  });

  function signUp(payload: Record<string, unknown> = signUpPayload) {
    return request(app.getHttpServer()).post("/api/v1/auth/signup").send(payload);
  }

  describe("POST /api/v1/auth/signup", () => {
    it("returns 201 with an AuthResponse matching API.md", async () => {
      const response = await signUp();

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        user: {
          id: expect.any(String),
          email: "alice@example.com",
          displayName: "Alice",
        },
        accessToken: expect.any(String),
        tokenType: "Bearer",
        expiresIn: 3600,
      });
    });

    it("never includes passwordHash in the response", async () => {
      const response = await signUp();
      expect(JSON.stringify(response.body)).not.toContain("passwordHash");
      expect(JSON.stringify(response.body)).not.toContain("argon2");
    });

    it("returns 409 EMAIL_ALREADY_EXISTS for a duplicate normalized email", async () => {
      await signUp();
      const response = await signUp({ ...signUpPayload, email: "  Alice@Example.COM " });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe("EMAIL_ALREADY_EXISTS");
      expect(response.body.message).toBe("An account with this email already exists.");
      expect(response.body.error).toBe("Conflict");
      expect(response.body.requestId).toEqual(expect.any(String));
    });

    it("sets the request-id response header on an error response", async () => {
      await signUp();
      const response = await signUp(); // second call: duplicate → error path

      expect(response.headers[REQUEST_ID_HEADER.toLowerCase()]).toBe(
        response.body.requestId,
      );
    });

    it("returns 400 VALIDATION_ERROR for an invalid payload", async () => {
      const response = await signUp({
        email: "not-an-email",
        password: "short",
        displayName: "",
      });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });

    it("rejects undeclared fields (mass-assignment protection)", async () => {
      const response = await signUp({ ...signUpPayload, role: "OWNER" });
      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/v1/auth/signin", () => {
    beforeEach(async () => {
      await signUp();
    });

    it("returns 200, not 201, for successful sign-in", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/signin")
        .send({ email: "alice@example.com", password: "correct-horse-battery" });

      expect(response.status).toBe(200);
      expect(response.body.user.email).toBe("alice@example.com");
    });

    it("returns an identical 401 body for unknown email and wrong password", async () => {
      const unknownEmail = await request(app.getHttpServer())
        .post("/api/v1/auth/signin")
        .send({ email: "ghost@example.com", password: "correct-horse-battery" });

      const wrongPassword = await request(app.getHttpServer())
        .post("/api/v1/auth/signin")
        .send({ email: "alice@example.com", password: "definitely-wrong" });

      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.body.code).toBe("INVALID_CREDENTIALS");

      // requestId is unique per request; compare everything else.
      const { requestId: _a, ...unknownBody } = unknownEmail.body;
      const { requestId: _b, ...wrongBody } = wrongPassword.body;
      expect(unknownBody).toEqual(wrongBody);
    });
  });

  describe("GET /api/v1/auth/me", () => {
    it("returns 401 AUTHENTICATION_REQUIRED without a token", async () => {
      const response = await request(app.getHttpServer()).get("/api/v1/auth/me");

      expect(response.status).toBe(401);
      expect(response.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("returns 401 AUTHENTICATION_REQUIRED for a non-Bearer scheme", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Authorization", "Basic YWxpY2U6cGFzcw==");

      expect(response.status).toBe(401);
      expect(response.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("returns 401 INVALID_ACCESS_TOKEN for a malformed token", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Authorization", "Bearer not.a.jwt");

      expect(response.status).toBe(401);
      expect(response.body.code).toBe("INVALID_ACCESS_TOKEN");
    });

    it("returns the SafeUser for a valid token", async () => {
      const signUpResponse = await signUp();
      const token = signUpResponse.body.accessToken;

      const response = await request(app.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: signUpResponse.body.user.id,
        email: "alice@example.com",
        displayName: "Alice",
      });
    });

    it("accepts a token issued by sign-in as well as sign-up", async () => {
      await signUp();
      const signInResponse = await request(app.getHttpServer())
        .post("/api/v1/auth/signin")
        .send({ email: "alice@example.com", password: "correct-horse-battery" });

      const response = await request(app.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${signInResponse.body.accessToken}`);

      expect(response.status).toBe(200);
    });
  });

  it.each(["/api/v1/health", "/api/v1/health/db"])(
    "keeps %s public with the real global guard",
    async path => {
      await request(app.getHttpServer())
        .get(path)
        .expect(200)
        .expect({ status: "healthy" });
    },
  );

  it.each([
    ["get", "/api/v1/organizations"],
    ["post", "/api/v1/organizations"],
    ["get", "/api/v1/organizations/8e32b232-eeda-4c5e-bbf0-427e799ff076"],
    ["patch", "/api/v1/organizations/8e32b232-eeda-4c5e-bbf0-427e799ff076"],
  ] as const)("protects %s %s by default", async (method, path) => {
    const response = await request(app.getHttpServer())[method](path)
      .send(
        method === "post" || method === "patch"
          ? { name: "Protected" }
          : undefined,
      )
      .expect(401);

    expect(response.body.code).toBe("AUTHENTICATION_REQUIRED");
    expect(prismaMock.membership.findMany).not.toHaveBeenCalled();
  });

  it.each([
    "missing subject",
    "invalid subject",
    "missing expiration",
    "expired",
    "wrong issuer",
    "wrong audience",
    "wrong signature",
    "wrong algorithm",
  ])("rejects a token with %s before database lookup", async kind => {
    const config = app.get(ConfigService<EnvironmentVariables>);

    const payload: { sub?: string; exp?: number } = {
      sub: randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    if (kind === "missing subject") delete payload.sub;
    if (kind === "invalid subject") payload.sub = "user-123";
    if (kind === "missing expiration") delete payload.exp;
    if (kind === "expired") payload.exp = 1;

    // Change one property at a time so each failure has a clear cause.
    const token = sign(
      payload,
      kind === "wrong signature"
        ? "a-different-test-secret-at-least-32-bytes"
        : config.getOrThrow("JWT_SECRET", { infer: true }),
      {
        issuer: kind === "wrong issuer"
          ? "another-issuer"
          : config.getOrThrow("JWT_ISSUER", { infer: true }),
        audience: kind === "wrong audience"
          ? "another-audience"
          : config.getOrThrow("JWT_AUDIENCE", { infer: true }),
        algorithm: kind === "wrong algorithm" ? "HS384" : "HS256",
      },
    );

    // Cover both the auth consumer and the organization consumer.
    for (const path of ["/api/v1/auth/me", "/api/v1/organizations"]) {
      const response = await request(app.getHttpServer())
        .get(path)
        .set("Authorization", "Bearer " + token)
        .expect(401);

      expect(response.body.code).toBe(
        kind === "expired"
          ? "ACCESS_TOKEN_EXPIRED"
          : "INVALID_ACCESS_TOKEN",
      );

      expect(response.body.requestId).toBe(
        response.headers["x-request-id"],
      );
    }

    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.membership.findMany).not.toHaveBeenCalled();
  });
});
