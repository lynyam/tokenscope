import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");

import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { configureApp } from "../../src/configure-app";
import { PrismaService } from "../../src/database/prisma.service";
import { ProjectAccessService } from "../../src/projects/project-access.service";

const ids = {
  owner: randomUUID(),
  admin: randomUUID(),
  member: randomUUID(),
  outsider: randomUUID(),
  orgA: randomUUID(),
  orgB: randomUUID(),
};

const base = `/api/v1/organizations/${ids.orgA}/projects`;
const otherBase = `/api/v1/organizations/${ids.orgB}/projects`;

const projectFields = [
  "id",
  "organizationId",
  "name",
  "slug",
  "description",
  "archivedAt",
  "createdAt",
  "updatedAt",
].sort();

describe("Project endpoints with PostgreSQL", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: TokenService;
  let projectAccess: ProjectAccessService;

  const bearer = (userId: string) =>
    "Bearer " + tokens.signAccessToken(userId).accessToken;

  const memberKey = (userId: string) => ({
    organizationId_userId: {
      organizationId: ids.orgA,
      userId,
    },
  });

  async function fixtureProject(
    organizationId: string,
    name: string,
    extra: {
      id?: string;
      createdAt?: Date;
      archivedAt?: Date;
      description?: string | null;
    } = {},
  ) {
    return prisma.project.create({
      data: {
        organizationId,
        name,
        slug: name.toLowerCase().replace(/\s+/g, "-"),
        ...extra,
      },
    });
  }

  beforeAll(async () => {
    const context = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = context.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    projectAccess = app.get(ProjectAccessService);
  });

  beforeEach(async () => {
    // Jest's integration setup restricts this to tokenscope_test.
    // Delete children before parents because foreign keys restrict deletion.
    await prisma.project.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.createMany({
      data: (["owner", "admin", "member", "outsider"] as const)
        .map(name => ({
          id: ids[name],
          email: `${name}@projects.test`,
          displayName: name,
          passwordHash: "fixture-hash-never-return",
        })),
    });

    await prisma.organization.createMany({
      data: [
        { id: ids.orgA, name: "Tenant A", slug: "projects-tenant-a" },
        { id: ids.orgB, name: "Tenant B", slug: "projects-tenant-b" },
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

  it.each(["owner", "admin"] as const)(
    "allows %s to create a project with normalized values",
    async actor => {
      const response = await request(app.getHttpServer())
        .post(base)
        .set("Authorization", bearer(ids[actor]))
        .send({
          name: "  Support AI  ",
          description: "  Monitoring  ",
        })
        .expect(201);

      const saved = await prisma.project.findUniqueOrThrow({
        where: { id: response.body.id },
      });

      expect(saved).toMatchObject({
        organizationId: ids.orgA,
        name: "Support AI",
        slug: "support-ai",
        description: "Monitoring",
        archivedAt: null,
      });
      expect(Object.keys(response.body).sort()).toEqual(projectFields);
      expect(response.body).toEqual({
        id: saved.id,
        organizationId: saved.organizationId,
        name: saved.name,
        slug: saved.slug,
        description: saved.description,
        archivedAt: null,
        createdAt: saved.createdAt.toISOString(),
        updatedAt: saved.updatedAt.toISOString(),
      });
    },
  );

  it.each([
    [{ name: "No description" }, null],
    [{ name: "Blank description", description: "   " }, null],
  ] as const)(
    "stores empty or omitted descriptions as null",
    async (body, expected) => {
      const response = await request(app.getHttpServer())
        .post(base)
        .set("Authorization", bearer(ids.owner))
        .send(body)
        .expect(201);

      expect(response.body.description).toBe(expected);
      expect((await prisma.project.findUniqueOrThrow({
        where: { id: response.body.id },
      })).description).toBe(expected);
    },
  );

  it("returns an empty array and then an ordered active list", async () => {
    await request(app.getHttpServer())
      .get(base)
      .set("Authorization", bearer(ids.member))
      .expect(200)
      .expect([]);

    const sameTime = new Date("2026-09-01T00:00:00Z");
    const early = new Date("2026-08-31T00:00:00Z");

    const second = await fixtureProject(ids.orgA, "Second", {
      id: "00000000-0000-4000-8000-000000000002",
      createdAt: sameTime,
    });
    const first = await fixtureProject(ids.orgA, "First", {
      id: "00000000-0000-4000-8000-000000000001",
      createdAt: sameTime,
    });
    const earliest = await fixtureProject(ids.orgA, "Earliest", {
      createdAt: early,
    });
    await fixtureProject(ids.orgA, "Archived", {
      archivedAt: new Date(),
    });
    await fixtureProject(ids.orgB, "Other tenant");

    const response = await request(app.getHttpServer())
      .get(base)
      .set("Authorization", bearer(ids.member))
      .expect(200);

    expect(response.body.map((p: { id: string }) => p.id)).toEqual([
      earliest.id,
      first.id,
      second.id,
    ]);
    expect(response.body.every((p: { archivedAt: unknown }) =>
      p.archivedAt === null,
    )).toBe(true);
  });

  it.each(["owner", "admin", "member"] as const)(
    "allows %s to read an active project",
    async actor => {
      const saved = await fixtureProject(ids.orgA, "Readable");

      const response = await request(app.getHttpServer())
        .get(`${base}/${saved.id}`)
        .set("Authorization", bearer(ids[actor]))
        .expect(200);

      expect(response.body.id).toBe(saved.id);
      expect(Object.keys(response.body).sort()).toEqual(projectFields);
    },
  );

  it("conceals cross-organization routes, unknown IDs, and archives", async () => {
    const own = await fixtureProject(ids.orgA, "Own");
    const other = await fixtureProject(ids.orgB, "Other");
    const archived = await fixtureProject(ids.orgA, "Old", {
      archivedAt: new Date(),
    });

    for (const projectId of [
      other.id,
      archived.id,
      randomUUID(),
    ]) {
      for (const method of ["get", "patch", "delete"] as const) {
        const call = request(app.getHttpServer())[method](
          `${base}/${projectId}`,
        ).set("Authorization", bearer(ids.owner));

        if (method === "patch") call.send({ name: "Forbidden" });

        const response = await call.expect(404);
        expect(response.body.code).toBe("PROJECT_NOT_FOUND");
        expect(response.body.requestId).toBe(
          response.headers["x-request-id"],
        );
      }
    }

    // The route points to B, but the project belongs to A.
    const mismatch = await request(app.getHttpServer())
      .get(`${otherBase}/${own.id}`)
      .set("Authorization", bearer(ids.outsider))
      .expect(404);

    expect(mismatch.body.code).toBe("PROJECT_NOT_FOUND");
    expect((await prisma.project.findUniqueOrThrow({
      where: { id: own.id },
    })).name).toBe("Own");
  });

  it("conceals project detail and mutations from an outsider", async () => {
    const saved = await fixtureProject(ids.orgA, "Private");

    for (const method of ["get", "patch", "delete"] as const) {
      const call = request(app.getHttpServer())[method](
        `${base}/${saved.id}`,
      ).set("Authorization", bearer(ids.outsider));

      if (method === "patch") call.send({ name: "Forbidden" });

      const response = await call.expect(404);
      expect(response.body.code).toBe("PROJECT_NOT_FOUND");
    }

    expect((await prisma.project.findUniqueOrThrow({
      where: { id: saved.id },
    })).archivedAt).toBeNull();
  });

  it("conceals the organization from an outsider on list and create", async () => {
    await request(app.getHttpServer())
      .get(base)
      .set("Authorization", bearer(ids.outsider))
      .expect(404)
      .expect(response => {
        expect(response.body.code).toBe("ORGANIZATION_NOT_FOUND");
      });

    await request(app.getHttpServer())
      .post(base)
      .set("Authorization", bearer(ids.outsider))
      .send({ name: "Forbidden" })
      .expect(404)
      .expect(response => {
        expect(response.body.code).toBe("ORGANIZATION_NOT_FOUND");
      });

    expect(await prisma.project.count()).toBe(0);
  });

  it("prevents MEMBER from creating, updating, or archiving", async () => {
    const saved = await fixtureProject(ids.orgA, "Protected");

    const create = await request(app.getHttpServer())
      .post(base)
      .set("Authorization", bearer(ids.member))
      .send({ name: "No access" })
      .expect(403);

    const update = await request(app.getHttpServer())
      .patch(`${base}/${saved.id}`)
      .set("Authorization", bearer(ids.member))
      .send({ name: "No access" })
      .expect(403);

    const archive = await request(app.getHttpServer())
      .delete(`${base}/${saved.id}`)
      .set("Authorization", bearer(ids.member))
      .expect(403);

    for (const response of [create, update, archive]) {
      expect(response.body.code).toBe(
        "INSUFFICIENT_ORGANIZATION_ROLE",
      );
    }

    expect(await prisma.project.count()).toBe(1);
    expect(await prisma.project.findUniqueOrThrow({
      where: { id: saved.id },
    })).toMatchObject({
      name: "Protected",
      archivedAt: null,
    });
  });

  it.each(["owner", "admin"] as const)(
    "lets %s update name and clear description without changing slug",
    async actor => {
      const saved = await fixtureProject(ids.orgA, "Original", {
        description: "Old description",
      });

      const response = await request(app.getHttpServer())
        .patch(`${base}/${saved.id}`)
        .set("Authorization", bearer(ids[actor]))
        .send({
          name: "  Renamed  ",
          description: null,
        })
        .expect(200);

      const updated = await prisma.project.findUniqueOrThrow({
        where: { id: saved.id },
      });

      expect(updated).toMatchObject({
        name: "Renamed",
        slug: "original",
        description: null,
        archivedAt: null,
      });
      expect(response.body.name).toBe("Renamed");
      expect(response.body.slug).toBe("original");
      expect(response.body.description).toBeNull();
    },
  );

  it.each(["owner", "admin"] as const)(
    "lets %s archive once, returns 204, and reserves the slug",
    async actor => {
      const saved = await fixtureProject(ids.orgA, "Reserved");

      const response = await request(app.getHttpServer())
        .delete(`${base}/${saved.id}`)
        .set("Authorization", bearer(ids[actor]))
        .expect(204);

      expect(response.text).toBe("");
      const archived = await prisma.project.findUniqueOrThrow({
        where: { id: saved.id },
      });
      expect(archived.archivedAt).toBeInstanceOf(Date);

      await request(app.getHttpServer())
        .get(base)
        .set("Authorization", bearer(ids.owner))
        .expect(200)
        .expect([]);

      const duplicate = await request(app.getHttpServer())
        .post(base)
        .set("Authorization", bearer(ids.owner))
        .send({ name: "Reserved" })
        .expect(409);

      expect(duplicate.body.code).toBe("PROJECT_SLUG_CONFLICT");

      const secondDelete = await request(app.getHttpServer())
        .delete(`${base}/${saved.id}`)
        .set("Authorization", bearer(ids[actor]))
        .expect(404);

      expect(secondDelete.body.code).toBe("PROJECT_NOT_FOUND");
      expect(await prisma.project.count()).toBe(1);
    },
  );

  it("maps simultaneous same-slug creation to one 201 and one 409", async () => {
    const responses = await Promise.all([1, 2].map(() =>
      request(app.getHttpServer())
        .post(base)
        .set("Authorization", bearer(ids.owner))
        .send({ name: "Concurrent" }),
    ));

    expect(responses.map(response => response.status).sort()).toEqual([
      201,
      409,
    ]);
    expect(responses.find(response => response.status === 409)
      ?.body.code).toBe("PROJECT_SLUG_CONFLICT");
    expect(await prisma.project.count({
      where: { organizationId: ids.orgA, slug: "concurrent" },
    })).toBe(1);
  });

  it.each([
    {},
    { name: "" },
    { name: "   " },
    { name: "x".repeat(101) },
    { description: "x".repeat(2001) },
    { name: "Valid", slug: "injected" },
  ])("rejects invalid project input %j without changing the row", async body => {
    const saved = await fixtureProject(ids.orgA, "Unchanged");

    const response = await request(app.getHttpServer())
      .patch(`${base}/${saved.id}`)
      .set("Authorization", bearer(ids.owner))
      .send(body)
      .expect(400);

    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect((await prisma.project.findUniqueOrThrow({
      where: { id: saved.id },
    })).name).toBe("Unchanged");
  });

  it("does not update after the actor's role is reduced", async () => {
    const saved = await fixtureProject(ids.orgA, "Unchanged");

    const original = projectAccess.assertProjectAccess.bind(projectAccess);

    jest.spyOn(projectAccess, "assertProjectAccess")
      .mockImplementationOnce(async (...args) => {
        const result = await original(...args);

        // Commit the role change after the helper's successful read,
        // before ProjectsService issues its conditional update.
        await prisma.membership.update({
          where: memberKey(ids.owner),
          data: { role: "MEMBER" },
        });

        return result;
      });

    const response = await request(app.getHttpServer())
      .patch(`${base}/${saved.id}`)
      .set("Authorization", bearer(ids.owner))
      .send({ name: "Forbidden" })
      .expect(403);

    expect(response.body.code).toBe(
      "INSUFFICIENT_ORGANIZATION_ROLE",
    );
    expect((await prisma.project.findUniqueOrThrow({
      where: { id: saved.id },
    })).name).toBe("Unchanged");
  });

  it("does not archive after the actor's membership is removed", async () => {
    const saved = await fixtureProject(ids.orgA, "Still active");

    const original = projectAccess.assertProjectAccess.bind(projectAccess);

    jest.spyOn(projectAccess, "assertProjectAccess")
      .mockImplementationOnce(async (...args) => {
        const result = await original(...args);

        await prisma.membership.delete({
          where: memberKey(ids.owner),
        });

        return result;
      });

    const response = await request(app.getHttpServer())
      .delete(`${base}/${saved.id}`)
      .set("Authorization", bearer(ids.owner))
      .expect(404);

    expect(response.body.code).toBe("PROJECT_NOT_FOUND");
    expect((await prisma.project.findUniqueOrThrow({
      where: { id: saved.id },
    })).archivedAt).toBeNull();
  });
    describe("archived organization", () => {
    it("answers PROJECT_NOT_FOUND on every project endpoint", async () => {
      const project = await fixtureProject(ids.orgA, "Visible");
      await prisma.organization.update({ where: { id: ids.orgA }, data: { archivedAt: new Date() } });
      const auth = { Authorization: bearer(ids.owner) };
      const one = base + "/" + project.id;

      const server = app.getHttpServer();
      const calls = [
        [() => request(server).get(base).set(auth), "ORGANIZATION_NOT_FOUND"],
        [() => request(server).post(base).set(auth).send({ name: "New" }), "ORGANIZATION_NOT_FOUND"],
        [() => request(server).get(one).set(auth), "PROJECT_NOT_FOUND"],
        [() => request(server).patch(one).set(auth).send({ name: "Changed" }), "PROJECT_NOT_FOUND"],
        [() => request(server).delete(one).set(auth), "PROJECT_NOT_FOUND"],
      ] as const;
      for (const [makeCall, code] of calls) {
        const response = await makeCall().expect(404);
        expect(response.body.code).toBe(code);
      }
      const unchanged = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      expect(unchanged.name).toBe("Visible");
      expect(unchanged.archivedAt).toBeNull();
      expect(await prisma.project.count({ where: { organizationId: ids.orgA } })).toBe(1);
    });
  });
});
