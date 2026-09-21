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
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/configure-app";
import { PrismaService } from "../../src/database/prisma.service";
import { REQUEST_ID_HEADER } from "../../src/common/constants/http.constants";

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
        const user = { id: `user-${users.length + 1}`, ...data };
        users.push(user);
        return user;
      }),
    },
    membership: { findFirst: jest.fn(), findMany: jest.fn() },
    organization: { findMany: jest.fn(), findFirst: jest.fn() },
    project: { findFirst: jest.fn(), findMany: jest.fn() },
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

    app = moduleFixture.createNestApplication();
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
});