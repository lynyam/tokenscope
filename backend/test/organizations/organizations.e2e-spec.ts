import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { ExecutionContext, INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { configureApp } from "../../src/configure-app";
import { PrismaService } from "../../src/database/prisma.service";
import { Prisma } from "../../src/generated/prisma/client";
import { OrganizationAccessService } from "../../src/memberships/organization-access.service";
import { OrganizationsController } from "../../src/organizations/organizations.controller";
import { OrganizationsService } from "../../src/organizations/organizations.service";

const actorId = randomUUID();
const organization = {
	id: randomUUID(), name: "Original", slug: "original",
	createdAt: new Date("2026-09-01T00:00:00Z"),
	updatedAt: new Date("2026-09-01T00:00:00Z"),
};
const membership = {
	id: randomUUID(), userId: actorId, organizationId: organization.id,
	role: "OWNER", createdAt: organization.createdAt, updatedAt: organization.updatedAt,
	organization,
};

const base = "/api/v1/organizations";
const detail = base + "/" + organization.id;
// Test-only identity fixture: this suite proves organization behavior, not JWT verification.
const actorFixture = {
	canActivate(context: ExecutionContext): boolean {
		context.switchToHttp().getRequest().user = { id: actorId };
		return true;
	},
};

const dbError = (code: string, meta: Record<string, unknown> = {}) =>
	new Prisma.PrismaClientKnownRequestError("PRIVATE_DATABASE_DETAIL", {
		code, clientVersion: "7.9.1", meta,
	});

describe("Organization HTTP contract with a test-only actor", () => {
	let app: INestApplication;
	const prisma = {
		membership: { findMany: jest.fn(), findUnique: jest.fn() },
        organization: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
        $transaction: jest.fn(),
    };

	beforeAll(async () => {
		const context = await Test.createTestingModule({
			controllers: [OrganizationsController],
			providers: [
				OrganizationsService, OrganizationAccessService,
				{ provide: APP_GUARD, useValue: actorFixture },
				{ provide: PrismaService, useValue: prisma },
			],
		}).compile();
		app = context.createNestApplication({ logger: false });
		configureApp(app);
		await app.init();
	});

	beforeEach(() => {
		jest.resetAllMocks();
		prisma.membership.findMany.mockResolvedValue([membership]);
		prisma.membership.findUnique.mockResolvedValue(membership);
		prisma.organization.create.mockImplementation(async ({ data }) => ({
			...organization, name: data.name, slug: data.slug,
		}));
		prisma.organization.update.mockImplementation(async ({ data }) => ({
			...organization, name: data.name, updatedAt: new Date(),
		}));
		prisma.organization.findFirst.mockResolvedValue({ slug: organization.slug });
        prisma.$transaction.mockImplementation(
                async (operation: (tx: unknown) => Promise<unknown>) => operation(prisma),
        );
	});

	afterAll(async () => { await app?.close(); });

	it.each([{}, { name: "" }, { name: "   " }, { name: "a".repeat(101) }, { name: 42 }])(
		"rejects invalid names on create and rename", async body => {
			for (const method of ["post", "patch"] as const) {
				const response = await request(app.getHttpServer())[method](method === "post" ? base : detail)
				.send(body).expect(400);
				expect(response.body.code).toBe("VALIDATION_ERROR");
				expect(response.body.details.some((d: { field: string }) => d.field === "name")).toBe(true);
			}
			expect(prisma.organization.create).not.toHaveBeenCalled();
			expect(prisma.organization.update).not.toHaveBeenCalled();
		},
	);

	it("trims before validating length on create and rename", async () => {
		const name = "a".repeat(99);
		for (const method of ["post", "patch"] as const) {
			const response = await request(app.getHttpServer())[method](method === "post" ? base : detail)
			.send({ name: " " + name + " " })
			.expect(method === "post" ? 201 : 200);
			expect(response.body.name).toBe(name);
		}
	});

	it.each(["slug", "userId", "organizationId", "role", "createdAt", "updatedAt"])(
		"rejects protected body field %s", async field => {
			for (const method of ["post", "patch"] as const) {
				const response = await request(app.getHttpServer())[method](method === "post" ? base : detail)
				.send({ name: "New", [field]: "injected" }).expect(400);
				expect(response.body.code).toBe("VALIDATION_ERROR");
			}
		},
	);

	it.each(["get", "patch"] as const)("rejects malformed UUID on %s before database access", async method => {
		const response = await request(app.getHttpServer())[method](base + "/not-a-uuid")
		.send(method === "patch" ? { name: "New" } : undefined)
		.expect(400);
		expect(response.body.code).toBe("VALIDATION_ERROR");
		expect(prisma.membership.findUnique).not.toHaveBeenCalled();
	});

	it.each(["ADMIN", "MEMBER"])("rejects rename for %s", async role => {
		prisma.membership.findUnique.mockResolvedValue({ ...membership, role });
		const response = await request(app.getHttpServer()).patch(detail)
		.send({ name: "New" }).expect(403);
		expect(response.body.code).toBe("INSUFFICIENT_ORGANIZATION_ROLE");
		expect(prisma.organization.update).not.toHaveBeenCalled();
	});

  it("renames for OWNER without changing the slug or exposing extra fields", async () => {
    const response = await request(app.getHttpServer()).patch(detail)
      .send({ name: "Renamed" }).expect(200);
    expect(response.body).toMatchObject({ name: "Renamed", slug: "original", currentUserRole: "OWNER" });
    expect(Object.keys(response.body).sort()).toEqual([
      "id", "name", "slug", "currentUserRole", "createdAt", "updatedAt",
    ].sort());
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: organization.id, archivedAt: null, memberships: { some: { userId: actorId, role: "OWNER" } } },
      data: { name: "Renamed" },
    });
  });

  it("conceals membership removed between the two detail reads", async () => {
    prisma.membership.findUnique.mockResolvedValueOnce(membership).mockResolvedValueOnce(null);
    const response = await request(app.getHttpServer()).get(detail)
      .expect(404);
    expect(response.body.code).toBe("ORGANIZATION_NOT_FOUND");
  });

  it.each([
    ["removed", null, 404, "ORGANIZATION_NOT_FOUND"],
    ["demoted", { ...membership, role: "MEMBER" }, 403, "INSUFFICIENT_ORGANIZATION_ROLE"],
  ] as const)("maps a failed scoped rename after access was %s", async (_label, latest, status, code) => {
    prisma.membership.findUnique.mockResolvedValueOnce(membership).mockResolvedValueOnce(latest);
    prisma.organization.update.mockRejectedValue(dbError("P2025"));
    const response = await request(app.getHttpServer()).patch(detail)
      .send({ name: "New" }).expect(status);
    expect(response.body.code).toBe(code);
  });

  it.each([
    { modelName: "Organization", target: ["slug"] },
    { modelName: "Organization", driverAdapterError: {
      cause: { kind: "UniqueConstraintViolation", constraint: { fields: ["slug"] } },
    } },
  ])("maps a database slug conflict to a correlated 409", async meta => {
    prisma.organization.create.mockRejectedValue(dbError("P2002", meta));
    const response = await request(app.getHttpServer()).post(base)
      .set("X-Request-Id", "slug-conflict")
      .send({ name: "Duplicate" }).expect(409);
    expect(response.body.code).toBe("ORGANIZATION_SLUG_CONFLICT");
    expect(response.body.requestId).toBe("slug-conflict");
    expect(response.headers["x-request-id"]).toBe("slug-conflict");
    expect(JSON.stringify(response.body)).not.toContain("PRIVATE_DATABASE_DETAIL");
  });

  it("keeps unexpected database errors as safe 500 responses", async () => {
    prisma.organization.create.mockRejectedValue(dbError("P2002", { target: ["id"] }));
    const response = await request(app.getHttpServer()).post(base)
      .send({ name: "New" }).expect(500);
    expect(response.body.code).toBe("INTERNAL_SERVER_ERROR");
    expect(JSON.stringify(response.body)).not.toContain("PRIVATE_DATABASE_DETAIL");
  });
    describe("DELETE /organizations/:organizationId", () => {
    it("archives for OWNER with the exact slug and returns 204 without a body", async () => {
      const response = await request(app.getHttpServer()).delete(detail)
        .send({ confirmSlug: "original" }).expect(204);
      expect(response.text).toBe("");
      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: organization.id, archivedAt: null, memberships: { some: { userId: actorId, role: "OWNER" } } },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it.each(["Original", "original ", " original", "other"])(
      "rejects the non-exact confirmSlug %j with 409", async confirmSlug => {
        const response = await request(app.getHttpServer()).delete(detail)
          .send({ confirmSlug }).expect(409);
        expect(response.body.code).toBe("ORGANIZATION_CONFIRMATION_MISMATCH");
        expect(prisma.organization.update).not.toHaveBeenCalled();
      },
    );

    it.each(["ADMIN", "MEMBER"])(
      "rejects %s with 403 even when the confirmation is wrong", async role => {
        prisma.membership.findUnique.mockResolvedValue({ ...membership, role });
        const response = await request(app.getHttpServer()).delete(detail)
          .send({ confirmSlug: "wrong" }).expect(403);
        expect(response.body.code).toBe("INSUFFICIENT_ORGANIZATION_ROLE");
        expect(prisma.organization.findFirst).not.toHaveBeenCalled();
        expect(prisma.organization.update).not.toHaveBeenCalled();
      },
    );

    it("returns 404 to a non-member before comparing the confirmation", async () => {
      prisma.membership.findUnique.mockResolvedValue(null);
      const response = await request(app.getHttpServer()).delete(detail)
        .send({ confirmSlug: "wrong" }).expect(404);
      expect(response.body.code).toBe("ORGANIZATION_NOT_FOUND");
      expect(prisma.organization.findFirst).not.toHaveBeenCalled();
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it("returns 404 when the organization was archived after the role check", async () => {
      prisma.organization.findFirst.mockResolvedValue(null);
      const response = await request(app.getHttpServer()).delete(detail)
        .send({ confirmSlug: "original" }).expect(404);
      expect(response.body.code).toBe("ORGANIZATION_NOT_FOUND");
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it.each([
      ["removed", null, 404, "ORGANIZATION_NOT_FOUND"],
      ["demoted", { ...membership, role: "MEMBER" }, 403, "INSUFFICIENT_ORGANIZATION_ROLE"],
    ] as const)("maps a failed scoped archive after access was %s", async (_label, latest, status, code) => {
      prisma.membership.findUnique.mockResolvedValueOnce(membership).mockResolvedValueOnce(latest);
      prisma.organization.update.mockRejectedValue(dbError("P2025"));
      const response = await request(app.getHttpServer()).delete(detail)
        .send({ confirmSlug: "original" }).expect(status);
      expect(response.body.code).toBe(code);
    });

    it.each([
      {}, { confirmSlug: "" }, { confirmSlug: "   " }, { confirmSlug: 42 },
      { confirmSlug: "original", extra: "x" },
      { confirmSlug: "original", organizationId: randomUUID() },
    ])("rejects the invalid body %j with 400", async body => {
      const response = await request(app.getHttpServer()).delete(detail)
        .send(body).expect(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejects a malformed organization id with 400", async () => {
      const response = await request(app.getHttpServer()).delete(base + "/invalid")
        .send({ confirmSlug: "original" }).expect(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });

    it("retries a transaction conflict and then succeeds", async () => {
      prisma.$transaction.mockRejectedValueOnce(dbError("P2034"));
      await request(app.getHttpServer()).delete(detail)
        .send({ confirmSlug: "original" }).expect(204);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it("returns 409 CONCURRENT_MODIFICATION after three conflicting attempts", async () => {
      prisma.$transaction.mockRejectedValue(dbError("P2034"));
      const response = await request(app.getHttpServer()).delete(detail)
        .send({ confirmSlug: "original" }).expect(409);
      expect(response.body.code).toBe("CONCURRENT_MODIFICATION");
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    });

    it("does not retry unrelated failures and hides them behind the standard 500", async () => {
      prisma.$transaction.mockRejectedValue(new Error("PRIVATE_DATABASE_DETAIL"));
      const response = await request(app.getHttpServer()).delete(detail)
        .send({ confirmSlug: "original" }).expect(500);
      expect(response.body.code).toBe("INTERNAL_SERVER_ERROR");
      expect(JSON.stringify(response.body)).not.toContain("PRIVATE_DATABASE_DETAIL");
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
