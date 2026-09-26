import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { sign } from "jsonwebtoken";
import request = require("supertest");
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/configure-app";
import type { EnvironmentVariables } from "../../src/config/env.validation";
import { PrismaService } from "../../src/database/prisma.service";
import { OrganizationAccessService } from "../../src/memberships/organization-access.service";
import { OrganizationsService } from "../../src/organizations/organizations.service";

const ids = {
  owner: randomUUID(), admin: randomUUID(), member: randomUUID(), outsider: randomUUID(),
  orgA: randomUUID(), orgB: randomUUID(),
};
const base = "/api/v1/organizations";
const detail = base + "/" + ids.orgA;
const oldDate = new Date("2020-01-02T00:00:00Z");

describe("Organization endpoints with PostgreSQL", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let access: OrganizationAccessService;
  let config: ConfigService<EnvironmentVariables>;

  const bearer = (userId: string) => "Bearer " + sign(
    { sub: userId },
    config.getOrThrow("JWT_SECRET", { infer: true }),
    {
      algorithm: "HS256",
      issuer: config.getOrThrow("JWT_ISSUER", { infer: true }),
      audience: config.getOrThrow("JWT_AUDIENCE", { infer: true }),
      expiresIn: config.getOrThrow("JWT_ACCESS_TTL_SECONDS", { infer: true }),
    },
  );
  const memberKey = (userId: string) => ({
    organizationId_userId: { organizationId: ids.orgA, userId },
  });

  beforeAll(async () => {
    // jest-integration.json runs require-test-database.ts before this file.
    const context = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = context.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    access = app.get(OrganizationAccessService);
    config = app.get(ConfigService);
  });

  beforeEach(async () => {
    // Destructive cleanup is limited to the guarded, isolated test database.
    await prisma.project.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.createMany({
      data: (["owner", "admin", "member", "outsider"] as const).map(name => ({
        id: ids[name], email: name + "@organizations.test", displayName: name,
        passwordHash: "test-fixture-hash-never-return",
      })),
    });
    await prisma.organization.createMany({
      data: [
        { id: ids.orgA, name: "Original", slug: "original", createdAt: oldDate, updatedAt: oldDate },
        { id: ids.orgB, name: "Other tenant", slug: "other-tenant" },
      ],
    });
    await prisma.membership.createMany({
      data: [
        { organizationId: ids.orgA, userId: ids.owner, role: "OWNER" },
        { organizationId: ids.orgA, userId: ids.admin, role: "ADMIN" },
        { organizationId: ids.orgA, userId: ids.member, role: "MEMBER" },
        { organizationId: ids.orgB, userId: ids.outsider, role: "OWNER" },
      ],
    });
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app?.close(); });

  it("creates a trimmed organization and exactly one initial OWNER", async () => {
    const response = await request(app.getHttpServer()).post(base)
      .set("Authorization", bearer(ids.owner)).send({ name: "  New workspace  " }).expect(201);
    expect(response.body).toMatchObject({
      name: "New workspace", slug: "new-workspace", currentUserRole: "OWNER",
    });
    expect(Object.keys(response.body).sort()).toEqual([
      "id", "name", "slug", "currentUserRole", "createdAt", "updatedAt",
    ].sort());
    expect(response.body.createdAt).toBe(new Date(response.body.createdAt).toISOString());
    expect(response.body.updatedAt).toBe(new Date(response.body.updatedAt).toISOString());
    const members = await prisma.membership.findMany({ where: { organizationId: response.body.id } });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: ids.owner, role: "OWNER" });
  });

  it("rolls back organization creation if initial membership creation fails", async () => {
    await expect(app.get(OrganizationsService).create(randomUUID(), { name: "Rollback fixture" }))
      .rejects.toMatchObject({ code: "P2003" });
    expect(await prisma.organization.findUnique({ where: { slug: "rollback-fixture" } })).toBeNull();
  });

  it("lists only the caller's organizations", async () => {
    const response = await request(app.getHttpServer()).get(base)
      .set("Authorization", bearer(ids.owner)).expect(200);
    expect(response.body.map((o: { id: string }) => o.id)).toEqual([ids.orgA]);
    const other = await request(app.getHttpServer()).get(base)
      .set("Authorization", bearer(ids.outsider)).expect(200);
    expect(other.body.map((o: { id: string }) => o.id)).toEqual([ids.orgB]);
  });

  it("returns an empty list for a user without memberships", async () => {
    const user = await prisma.user.create({
      data: { email: "empty@organizations.test", displayName: "Empty", passwordHash: "fixture-hash" },
    });
    await request(app.getHttpServer()).get(base)
      .set("Authorization", bearer(user.id)).expect(200).expect([]);
  });

  it("orders by organization creation time then ID, independent of membership creation time", async () => {
    const earlier = new Date("2020-01-01T00:00:00Z");
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    for (const [id, createdAt] of [
      [second, new Date("2019-01-01T00:00:00Z")],
      [first, new Date("2021-01-01T00:00:00Z")],
    ] as const) {
      await prisma.organization.create({
        data: {
          id, name: id, slug: id, createdAt: earlier,
          memberships: { create: { userId: ids.owner, role: "OWNER", createdAt } },
        },
      });
    }
    const response = await request(app.getHttpServer()).get(base)
      .set("Authorization", bearer(ids.owner)).expect(200);
    expect(response.body.map((o: { id: string }) => o.id)).toEqual([first, second, ids.orgA]);
  });

  it.each([
    ["owner", "OWNER"], ["admin", "ADMIN"], ["member", "MEMBER"],
  ] as const)("allows detail access for %s and returns the current role", async (actor, role) => {
    const response = await request(app.getHttpServer()).get(detail)
      .set("Authorization", bearer(ids[actor])).expect(200);
    expect(response.body).toMatchObject({ id: ids.orgA, currentUserRole: role });
    expect(Object.keys(response.body).sort()).toEqual([
      "id", "name", "slug", "currentUserRole", "createdAt", "updatedAt",
    ].sort());
  });

  it.each([ids.orgB, randomUUID()])("conceals inaccessible or unknown organization %s", async id => {
    for (const method of ["get", "patch"] as const) {
      const response = await request(app.getHttpServer())[method](base + "/" + id)
        .set("Authorization", bearer(ids.owner))
        .send(method === "patch" ? { name: "Should not change" } : undefined).expect(404);
      expect(response.body.code).toBe("ORGANIZATION_NOT_FOUND");
      expect(response.body.message).toBe("Organization not found.");
    }
  });

  it("renames for OWNER while preserving slug and returning persisted timestamps", async () => {
    const response = await request(app.getHttpServer()).patch(detail)
      .set("Authorization", bearer(ids.owner)).send({ name: "  Renamed workspace  " }).expect(200);
    const saved = await prisma.organization.findUniqueOrThrow({ where: { id: ids.orgA } });
    expect(saved.name).toBe("Renamed workspace");
    expect(saved.slug).toBe("original");
    expect(saved.updatedAt.getTime()).toBeGreaterThan(oldDate.getTime());
    expect(response.body).toEqual({
      id: saved.id, name: saved.name, slug: saved.slug, currentUserRole: "OWNER",
      createdAt: saved.createdAt.toISOString(), updatedAt: saved.updatedAt.toISOString(),
    });
  });

  it.each(["admin", "member"] as const)("rejects rename for %s without changing data", async actor => {
    const response = await request(app.getHttpServer()).patch(detail)
      .set("Authorization", bearer(ids[actor])).send({ name: "Forbidden" }).expect(403);
    expect(response.body.code).toBe("INSUFFICIENT_ORGANIZATION_ROLE");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: ids.orgA } })).name).toBe("Original");
  });

  it("returns 409 for a sequential slug conflict", async () => {
    const response = await request(app.getHttpServer()).post(base)
      .set("Authorization", bearer(ids.owner)).send({ name: "Original" }).expect(409);
    expect(response.body.code).toBe("ORGANIZATION_SLUG_CONFLICT");
    expect(await prisma.organization.count({ where: { slug: "original" } })).toBe(1);
  });

  it("returns one 201 and one 409 for simultaneous creation of the same slug", async () => {
    const responses = await Promise.all([1, 2].map(() =>
      request(app.getHttpServer()).post(base).set("Authorization", bearer(ids.owner))
        .send({ name: "Concurrent workspace" }),
    ));
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    expect(responses.find(r => r.status === 409)?.body.code).toBe("ORGANIZATION_SLUG_CONFLICT");
    const organizations = await prisma.organization.findMany({ where: { slug: "concurrent-workspace" } });
    expect(organizations).toHaveLength(1);
    expect(await prisma.membership.count({ where: { organizationId: organizations[0].id, role: "OWNER" } })).toBe(1);
  });

  it("observes membership removal committed between the detail checks", async () => {
    await prisma.membership.update({ where: memberKey(ids.admin), data: { role: "OWNER" } });
    const original = access.assertOrganizationMember.bind(access);
    jest.spyOn(access, "assertOrganizationMember").mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      await prisma.membership.delete({ where: memberKey(ids.owner) });
      return result;
    });
    const response = await request(app.getHttpServer()).get(detail)
      .set("Authorization", bearer(ids.owner)).expect(404);
    expect(response.body.code).toBe("ORGANIZATION_NOT_FOUND");
  });

  it.each(["remove", "demote"] as const)(
    "does not rename if access changes after the role helper: %s", async change => {
      await prisma.membership.update({ where: memberKey(ids.admin), data: { role: "OWNER" } });
      const original = access.assertOrganizationRole.bind(access);
      jest.spyOn(access, "assertOrganizationRole").mockImplementationOnce(async (...args) => {
        const result = await original(...args);
        if (change === "remove") await prisma.membership.delete({ where: memberKey(ids.owner) });
        else await prisma.membership.update({ where: memberKey(ids.owner), data: { role: "MEMBER" } });
        return result;
      });
      const response = await request(app.getHttpServer()).patch(detail)
        .set("Authorization", bearer(ids.owner)).send({ name: "Forbidden" })
        .expect(change === "remove" ? 404 : 403);
      expect(response.body.code).toBe(change === "remove" ? "ORGANIZATION_NOT_FOUND" : "INSUFFICIENT_ORGANIZATION_ROLE");
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: ids.orgA } })).name).toBe("Original");
    },
  );
});
