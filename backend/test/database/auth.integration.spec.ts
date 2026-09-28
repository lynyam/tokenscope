import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as argon2 from "argon2";
import request = require("supertest");
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/configure-app";
import { PrismaService } from "../../src/database/prisma.service";
import { UsersService } from "../../src/users/users.service";

// The integration runner applies require-test-database.ts before this file.
// Its guard restricts cleanup to the isolated tokenscope_test database.
describe("Authentication HTTP endpoints with PostgreSQL", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const credentials = {
    email: "alice@authentication.test",
    password: "  correct-horse-battery  ",
    displayName: "Alice",
  };

  const signup = (body = credentials) =>
    request(app.getHttpServer())
      .post("/api/v1/auth/signup")
      .send(body);

  const signin = (email: string, password: string) =>
    request(app.getHttpServer())
      .post("/api/v1/auth/signin")
      .send({ email, password });

  beforeAll(async () => {
    // Use the real modules, guard, services, mapper, and database.
    const context = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = context.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    // Delete dependent records first because foreign keys are restrictive.
    await prisma.project.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app?.close(); });

  it("normalizes identity, stores Argon2id, and returns safe responses", async () => {
    const response = await signup({
      ...credentials,
      email: "  Alice@Authentication.TEST  ",
      displayName: "  Alice  ",
    }).expect(201);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: response.body.user.id },
    });

    const safeUser = {
      id: user.id,
      email: credentials.email,
      displayName: "Alice",
    };

    expect(user.email).toBe(credentials.email);
    expect(user.displayName).toBe("Alice");
    expect(user.passwordHash.startsWith("$argon2id$")).toBe(true);

    // Password whitespace is meaningful and must survive signup unchanged.
    expect(
      await argon2.verify(user.passwordHash, credentials.password),
    ).toBe(true);
    expect(
      await argon2.verify(user.passwordHash, credentials.password.trim()),
    ).toBe(false);

    // Exact equality rejects accidental extra fields such as passwordHash.
    expect(response.body).toEqual({
      user: safeUser,
      accessToken: expect.any(String),
      tokenType: "Bearer",
      expiresIn: 3600,
    });

    const login = await signin(
      " ALICE@Authentication.TEST ",
      credentials.password,
    ).expect(200);

    expect(login.body).toEqual({
      user: safeUser,
      accessToken: expect.any(String),
      tokenType: "Bearer",
      expiresIn: 3600,
    });

    for (const token of [
      response.body.accessToken,
      login.body.accessToken,
    ]) {
      await request(app.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Authorization", "Bearer " + token)
        .expect(200)
        .expect(safeUser);
    }
  });

  it("rejects a duplicate normalized email with the documented 409", async () => {
    await signup().expect(201);

    const response = await signup({
      ...credentials,
      email: " ALICE@Authentication.TEST ",
    })
      .set("X-Request-Id", "duplicate-email")
      .expect(409);

    expect(response.body).toEqual({
      statusCode: 409,
      code: "EMAIL_ALREADY_EXISTS",
      error: "Conflict",
      message: "An account with this email already exists.",
      requestId: "duplicate-email",
    });

    expect(await prisma.user.count()).toBe(1);
  });

  it("returns one 201 and one 409 for concurrent normalized signup", async () => {
    const users = app.get(UsersService);
    const lookup = users.findByEmail.bind(users);

    let arrivals = 0;
    let release!: () => void;
    const bothLookups = new Promise<void>(resolve => {
      release = resolve;
    });

    // Force both real database reads to finish before either insert starts.
    // This proves the database-conflict path, not only the preliminary lookup.
    jest.spyOn(users, "findByEmail").mockImplementation(async email => {
      const found = await lookup(email);

      if (++arrivals === 2) release();
      await bothLookups;

      return found;
    });

    const responses = await Promise.all([
      signup(),
      signup({
        ...credentials,
        email: " ALICE@Authentication.TEST ",
      }),
    ]);

    expect(responses.map(response => response.status).sort())
      .toEqual([201, 409]);

    const conflict = responses.find(
      response => response.status === 409,
    )!;

    expect(conflict.body.code).toBe("EMAIL_ALREADY_EXISTS");
    expect(conflict.body.message).toBe(
      "An account with this email already exists.",
    );
    expect(conflict.body.requestId).toBe(
      conflict.headers["x-request-id"],
    );

    expect(await prisma.user.count()).toBe(1);
  });

  it("returns the same 401 for unknown email and incorrect password", async () => {
    await signup().expect(201);

    const missing = await signin(
      "missing@authentication.test",
      "incorrect",
    ).expect(401);

    const wrong = await signin(
      credentials.email,
      "incorrect",
    ).expect(401);

    // Correlation IDs differ per request; the public error contract must match.
    const { requestId: missingId, ...missingBody } = missing.body;
    const { requestId: wrongId, ...wrongBody } = wrong.body;

    expect(missingBody).toEqual(wrongBody);
    expect(missingBody).toEqual({
      statusCode: 401,
      code: "INVALID_CREDENTIALS",
      error: "Unauthorized",
      message: "Invalid email or password.",
    });

    expect(missingId).toBe(missing.headers["x-request-id"]);
    expect(wrongId).toBe(wrong.headers["x-request-id"]);
  });

  it("uses issued tokens for organizations and preserves tenant boundaries", async () => {
    const alice = await signup().expect(201);

    const bob = await signup({
      ...credentials,
      email: "bob@authentication.test",
      displayName: "Bob",
    }).expect(201);

    // Use tokens returned by the actual signup endpoint.
    // This verifies the shared contract between TSE-38 and TSE-39.
    const aliceHeader = "Bearer " + alice.body.accessToken;
    const bobHeader = "Bearer " + bob.body.accessToken;

    const created = await request(app.getHttpServer())
      .post("/api/v1/organizations")
      .set("Authorization", aliceHeader)
      .send({ name: "Auth workspace" })
      .expect(201);

    const organizationId = created.body.id;

    expect(
      await prisma.membership.findMany({ where: { organizationId } }),
    ).toEqual([
      expect.objectContaining({
        userId: alice.body.user.id,
        role: "OWNER",
      }),
    ]);

    const listed = await request(app.getHttpServer())
      .get("/api/v1/organizations")
      .set("Authorization", aliceHeader)
      .expect(200);

    expect(listed.body).toEqual([created.body]);

    await request(app.getHttpServer())
      .get("/api/v1/organizations")
      .set("Authorization", bobHeader)
      .expect(200)
      .expect([]);

    const hidden = await request(app.getHttpServer())
      .get("/api/v1/organizations/" + organizationId)
      .set("Authorization", bobHeader)
      .expect(404);

    expect(hidden.body.code).toBe("ORGANIZATION_NOT_FOUND");

    const renamed = await request(app.getHttpServer())
      .patch("/api/v1/organizations/" + organizationId)
      .set("Authorization", aliceHeader)
      .send({ name: "Renamed auth workspace" })
      .expect(200);

    expect(renamed.body.slug).toBe(created.body.slug);
    expect(renamed.body.currentUserRole).toBe("OWNER");
  });

  it("rejects current-user loading after account removal", async () => {
    const response = await signup().expect(201);

    await prisma.user.delete({
      where: { id: response.body.user.id },
    });

    const me = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer " + response.body.accessToken)
      .expect(401);

    expect(me.body.code).toBe("AUTHENTICATION_REQUIRED");
  });
});
