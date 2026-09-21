/**
 * TEST FILE — integration
 * Suite:  npm run test:integration   (config: test/jest-integration.json)
 * Scope:  Real PostgreSQL via the isolated test Compose project.
 *         test/support/require-test-database.ts runs first and guards
 *         against pointing at a non-test database.
 * Proves: what mocked unit tests cannot — that the database itself
 *         enforces the User.email unique constraint from DATA_MODEL.md,
 *         and that a real Argon2id hash round-trips through Postgres.
 */
import * as argon2 from "argon2";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Same adapter pattern as src/database/prisma.service.ts — the generated
// PrismaClient requires an explicit adapter, since this project uses
// @prisma/adapter-pg rather than Prisma's default connection handling.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

describe("Auth persistence (integration)", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.membership.deleteMany();
    await prisma.user.deleteMany();
  });

  it("stores an Argon2id hash that verifies against the original password", async () => {
    const passwordHash = await argon2.hash("correct-horse-battery", {
      type: argon2.argon2id,
    });

    const created = await prisma.user.create({
      data: {
        email: "alice@example.com",
        passwordHash,
        displayName: "Alice",
      },
    });

    const reloaded = await prisma.user.findUniqueOrThrow({
      where: { id: created.id },
    });

    expect(reloaded.passwordHash).not.toBe("correct-horse-battery");
    expect(reloaded.passwordHash).toContain("$argon2id$");
    expect(await argon2.verify(reloaded.passwordHash, "correct-horse-battery")).toBe(true);
  });

  it("rejects a duplicate email at the database level", async () => {
    await prisma.user.create({
      data: {
        email: "alice@example.com",
        passwordHash: "$argon2id$placeholder",
        displayName: "Alice",
      },
    });

    await expect(
      prisma.user.create({
        data: {
          email: "alice@example.com",
          passwordHash: "$argon2id$placeholder-two",
          displayName: "Alice Two",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("treats differently-cased emails as distinct rows at the database level", async () => {
    await prisma.user.create({
      data: {
        email: "alice@example.com",
        passwordHash: "$argon2id$one",
        displayName: "Alice",
      },
    });

    const differentCase = await prisma.user.create({
      data: {
        email: "Alice@Example.com",
        passwordHash: "$argon2id$two",
        displayName: "Alice Upper",
      },
    });

    expect(differentCase.id).toEqual(expect.any(String));
    expect(await prisma.user.count()).toBe(2);
  });
});