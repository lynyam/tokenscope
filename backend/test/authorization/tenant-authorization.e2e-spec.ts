import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Body, Controller, Get, Injectable, Patch } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { IsString, Length } from "class-validator";
import request = require("supertest");

import { configureApp } from "../../src/configure-app";
import { UuidParam } from "../../src/common/decorators/uuid-param.decorators";
import { PrismaService } from "../../src/database/prisma.service";
import { MembershipRole } from "../../src/generated/prisma/client";
import type { Membership } from "../../src/generated/prisma/client";
import { OrganizationAccessService } from "../../src/memberships/organization-access.service";
import { MembershipsModule } from "../../src/memberships/memberships.module";
import { ProjectAccessService } from "../../src/projects/project-access.service";
import { ProjectsModule } from "../../src/projects/projects.module";

const ids = { actor: randomUUID(), organization: randomUUID(), project: randomUUID() };
const membership: Membership = {
  id: randomUUID(), userId: ids.actor, organizationId: ids.organization,
  role: MembershipRole.OWNER, createdAt: new Date(), updatedAt: new Date(),
};
const READ_ROLES = [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MEMBER];
const WRITE_ROLES = [MembershipRole.OWNER, MembershipRole.ADMIN];
const basePath = "/api/v1/authorization-probe/organizations/" + ids.organization;
const projectPath = basePath + "/projects/" + ids.project;
const requestId = "tse42-http-check";

class RenameProbeDto {
  @IsString()
  @Length(1, 100)
  name!: string;
}

// These probe classes exist only in this test module. They do not register
// production endpoints, implement JWT authentication, or mutate the database.
@Injectable()
class AuthorizationProbeService {
  constructor(
    private readonly organizations: OrganizationAccessService,
    private readonly projects: ProjectAccessService,
  ) {}

  async renameOrganization(userId: string, organizationId: string, input: RenameProbeDto) {
    const access = await this.organizations.assertOrganizationRole(
      userId, organizationId, [MembershipRole.OWNER],
    );
    return { organizationId: access.organizationId, name: input.name };
  }

  readProject(userId: string, organizationId: string, projectId: string) {
    return this.projects.assertProjectAccess(userId, organizationId, projectId, READ_ROLES);
  }

  async renameProject(
    userId: string, organizationId: string, projectId: string, input: RenameProbeDto,
  ) {
    const access = await this.projects.assertProjectAccess(
      userId, organizationId, projectId, WRITE_ROLES,
    );
    return { id: access.id, name: input.name };
  }
}

@Controller("authorization-probe/organizations/:organizationId")
class AuthorizationProbeController {
  constructor(private readonly probe: AuthorizationProbeService) {}

  // The actor is a server-controlled test fixture. Real controllers must obtain
  // this value from TSE-38's verified authentication context, never the body.
  @Patch()
  renameOrganization(
    @UuidParam("organizationId") organizationId: string,
    @Body() input: RenameProbeDto,
  ) {
    return this.probe.renameOrganization(ids.actor, organizationId, input);
  }

  @Get("projects/:projectId")
  readProject(
    @UuidParam("organizationId") organizationId: string,
    @UuidParam("projectId") projectId: string,
  ) {
    return this.probe.readProject(ids.actor, organizationId, projectId);
  }

  @Patch("projects/:projectId")
  renameProject(
    @UuidParam("organizationId") organizationId: string,
    @UuidParam("projectId") projectId: string,
    @Body() input: RenameProbeDto,
  ) {
    return this.probe.renameProject(ids.actor, organizationId, projectId, input);
  }
}

function errorBody(statusCode: number, code: string, error: string, message: string) {
  return { statusCode, code, error, message, requestId };
}

describe("Tenant authorization HTTP contract", () => {
  let app: INestApplication;
  const prisma = {
    membership: { findUnique: jest.fn() },
    project: { findFirst: jest.fn() },
  };

  beforeAll(async () => {
    const context = await Test.createTestingModule({
      imports: [MembershipsModule, ProjectsModule],
      controllers: [AuthorizationProbeController],
      providers: [AuthorizationProbeService],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = context.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    prisma.membership.findUnique.mockReset().mockResolvedValue({ ...membership });
    prisma.project.findFirst.mockReset().mockResolvedValue(null);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("uses the server-controlled actor and route organization for authorization", async () => {
    await request(app.getHttpServer()).patch(basePath)
      .send({ name: "Renamed workspace" })
      .expect(200)
      .expect({ organizationId: ids.organization, name: "Renamed workspace" });

    expect(prisma.membership.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_userId: { organizationId: ids.organization, userId: ids.actor } },
    }));
  });

  it("returns a correlated organization 404 when membership is absent", async () => {
    prisma.membership.findUnique.mockResolvedValue(null);

    await request(app.getHttpServer()).patch(basePath)
      .set("X-Request-Id", requestId).send({ name: "Renamed" })
      .expect("X-Request-Id", requestId).expect(404)
      .expect(errorBody(404, "ORGANIZATION_NOT_FOUND", "Not Found", "Organization not found."));
  });

  it("preserves the organization role error as a correlated 403", async () => {
    prisma.membership.findUnique.mockResolvedValue({ ...membership, role: MembershipRole.MEMBER });

    await request(app.getHttpServer()).patch(basePath)
      .set("X-Request-Id", requestId).send({ name: "Renamed" })
      .expect("X-Request-Id", requestId).expect(403)
      .expect(errorBody(403, "INSUFFICIENT_ORGANIZATION_ROLE", "Forbidden",
        "You are not allowed to perform this action."));
  });

  it("conceals absent organization membership behind PROJECT_NOT_FOUND", async () => {
    prisma.membership.findUnique.mockResolvedValue(null);

    await request(app.getHttpServer()).get(projectPath)
      .set("X-Request-Id", requestId)
      .expect("X-Request-Id", requestId).expect(404)
      .expect(errorBody(404, "PROJECT_NOT_FOUND", "Not Found", "Project not found."));
    expect(prisma.project.findFirst).not.toHaveBeenCalled();
  });

  it("returns the same project 404 when the scoped query finds no project", async () => {
    await request(app.getHttpServer()).get(projectPath)
      .set("X-Request-Id", requestId)
      .expect("X-Request-Id", requestId).expect(404)
      .expect(errorBody(404, "PROJECT_NOT_FOUND", "Not Found", "Project not found."));
    expect(prisma.project.findFirst).toHaveBeenCalledTimes(1);
  });

  it("preserves project mutation 403 before attempting the project query", async () => {
    prisma.membership.findUnique.mockResolvedValue({ ...membership, role: MembershipRole.MEMBER });

    await request(app.getHttpServer()).patch(projectPath)
      .set("X-Request-Id", requestId).send({ name: "Renamed" })
      .expect("X-Request-Id", requestId).expect(403)
      .expect(errorBody(403, "INSUFFICIENT_ORGANIZATION_ROLE", "Forbidden",
        "You are not allowed to perform this action."));
    expect(prisma.project.findFirst).not.toHaveBeenCalled();
  });

  it.each(["membership", "project"] as const)(
    "maps a failed %s query to a safe 500 instead of concealing it as 404",
    async (query) => {
      const failure = new Error("DO_NOT_EXPOSE_DATABASE_CREDENTIALS_OR_SQL");
      if (query === "membership") prisma.membership.findUnique.mockRejectedValue(failure);
      else prisma.project.findFirst.mockRejectedValue(failure);

      await request(app.getHttpServer()).get(projectPath)
        .set("X-Request-Id", requestId)
        .expect("X-Request-Id", requestId).expect(500)
        .expect(errorBody(500, "INTERNAL_SERVER_ERROR", "Internal Server Error",
          "An unexpected error occurred."));
      if (query === "membership") expect(prisma.project.findFirst).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["userId", randomUUID()],
    ["organizationId", randomUUID()],
    ["role", "OWNER"],
    ["allowedRoles", ["OWNER", "ADMIN", "MEMBER"]],
    ["slug", "client-controlled-slug"],
    ["archivedAt", "2026-01-01T00:00:00.000Z"],
    ["passwordHash", "DO_NOT_EXPOSE_PASSWORD_HASH"],
  ])("rejects protected rename property %s before authorization runs", async (field, value) => {
    const response = await request(app.getHttpServer()).patch(basePath)
      .set("X-Request-Id", requestId).send({ name: "Renamed", [field as string]: value })
      .expect("X-Request-Id", requestId).expect(400);

    expect(response.body).toEqual({
      ...errorBody(400, "VALIDATION_ERROR", "Bad Request", "Request validation failed."),
      details: [{ field, messages: ["property " + field + " should not exist"] }],
    });
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
    expect(prisma.project.findFirst).not.toHaveBeenCalled();
  });
});
