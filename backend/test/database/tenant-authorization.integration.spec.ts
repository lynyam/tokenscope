import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import { ConfigurationModule } from "../../src/config/configuration.module";
import { PrismaService } from "../../src/database/prisma.service";
import { MembershipRole } from "../../src/generated/prisma/client";
import { OrganizationAccessService } from "../../src/memberships/organization-access.service";
import { ProjectAccessService } from "../../src/projects/project-access.service";
import { ProjectsModule } from "../../src/projects/projects.module";

const ids = {
  owner: randomUUID(),
  alice: randomUUID(),
  outsider: randomUUID(),
  orgA: randomUUID(),
  orgB: randomUUID(),
  projectA: randomUUID(),
  projectB: randomUUID(),
  archived: randomUUID(),
  missing: randomUUID(),
};

const READ_ROLES = [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MEMBER];
const WRITE_ROLES = [MembershipRole.OWNER, MembershipRole.ADMIN];
const ORGANIZATION_NOT_FOUND = {
  status: 404,
  code: "ORGANIZATION_NOT_FOUND",
  publicMessage: "Organization not found.",
};
const PROJECT_NOT_FOUND = {
  status: 404,
  code: "PROJECT_NOT_FOUND",
  publicMessage: "Project not found.",
};
const FORBIDDEN = { status: 403, code: "INSUFFICIENT_ORGANIZATION_ROLE" };

describe("Tenant authorization with PostgreSQL", () => {
  let context: TestingModule;
  let prisma: PrismaService;
  let organizations: OrganizationAccessService;
  let projects: ProjectAccessService;

  const aliceInA = () => ({
    organizationId_userId: { organizationId: ids.orgA, userId: ids.alice },
  });

  beforeAll(async () => {
    context = await Test.createTestingModule({
      imports: [ConfigurationModule, ProjectsModule],
    }).compile();
    await context.init();
    prisma = context.get(PrismaService);
    organizations = context.get(OrganizationAccessService);
    projects = context.get(ProjectAccessService);
  });

  beforeEach(async () => {
    // This suite is restricted to postgres-test by the Jest setup file.
    await prisma.project.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.createMany({
      data: (["owner", "alice", "outsider"] as const).map((name) => ({
        id: ids[name],
        email: `${name}@authorization.test`,
        displayName: name,
        passwordHash: "authorization-test-hash",
      })),
    });
    await prisma.organization.createMany({
      data: [
        { id: ids.orgA, name: "Organization A", slug: "organization-a" },
        { id: ids.orgB, name: "Organization B", slug: "organization-b" },
      ],
    });
    await prisma.membership.createMany({
      data: [
        { userId: ids.owner, organizationId: ids.orgA, role: "OWNER" },
        { userId: ids.owner, organizationId: ids.orgB, role: "OWNER" },
        { userId: ids.alice, organizationId: ids.orgA, role: "OWNER" },
        { userId: ids.alice, organizationId: ids.orgB, role: "MEMBER" },
      ],
    });
    await prisma.project.createMany({
      data: [
        { id: ids.projectA, organizationId: ids.orgA, name: "Project A", slug: "app" },
        { id: ids.projectB, organizationId: ids.orgB, name: "Project B", slug: "app" },
        {
          id: ids.archived,
          organizationId: ids.orgA,
          name: "Archived project",
          slug: "archived",
          archivedAt: new Date(),
        },
      ],
    });
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await context?.close(); });

  it("loads the caller's membership in the requested organization", async () => {
    await expect(organizations.assertOrganizationMember(ids.alice, ids.orgB))
      .resolves.toMatchObject({
        userId: ids.alice,
        organizationId: ids.orgB,
        role: MembershipRole.MEMBER,
      });
  });

  it.each([
    ["outsider", ids.outsider, ids.orgA],
    ["missing organization", ids.alice, ids.missing],
  ])("conceals an organization from %s", async (_label, userId, organizationId) => {
    await expect(organizations.assertOrganizationMember(userId, organizationId))
      .rejects.toMatchObject(ORGANIZATION_NOT_FOUND);
  });

  it("allows an OWNER to perform an OWNER-only operation", async () => {
    await expect(organizations.assertOrganizationRole(ids.alice, ids.orgA, [MembershipRole.OWNER]))
      .resolves.toMatchObject({ role: MembershipRole.OWNER });
  });

  it.each([MembershipRole.ADMIN, MembershipRole.MEMBER])(
    "rejects an OWNER-only operation for %s", async (role) => {
      await prisma.membership.update({ where: aliceInA(), data: { role } });
      await expect(organizations.assertOrganizationRole(ids.alice, ids.orgA, [MembershipRole.OWNER]))
        .rejects.toMatchObject(FORBIDDEN);
    },
  );

  it("denies access when no roles are allowed", async () => {
    await expect(organizations.assertOrganizationRole(ids.alice, ids.orgA, []))
      .rejects.toMatchObject(FORBIDDEN);
  });

  it("uses a committed role change on the next check", async () => {
    await organizations.assertOrganizationRole(ids.alice, ids.orgA, [MembershipRole.OWNER]);
    await prisma.membership.update({ where: aliceInA(), data: { role: MembershipRole.MEMBER } });
    await expect(organizations.assertOrganizationRole(ids.alice, ids.orgA, [MembershipRole.OWNER]))
      .rejects.toMatchObject(FORBIDDEN);
  });

  it("uses a committed membership removal on the next check", async () => {
    await organizations.assertOrganizationMember(ids.alice, ids.orgA);
    await prisma.membership.delete({ where: aliceInA() });
    await expect(organizations.assertOrganizationMember(ids.alice, ids.orgA))
      .rejects.toMatchObject(ORGANIZATION_NOT_FOUND);
  });

  it.each(READ_ROLES)("allows %s to read an active project", async (role) => {
    await prisma.membership.update({ where: aliceInA(), data: { role } });
    await expect(projects.assertProjectAccess(ids.alice, ids.orgA, ids.projectA, READ_ROLES))
      .resolves.toMatchObject({ id: ids.projectA, organizationId: ids.orgA, archivedAt: null });
  });

  it.each(WRITE_ROLES)("allows %s through the project mutation access check", async (role) => {
    await prisma.membership.update({ where: aliceInA(), data: { role } });
    await expect(projects.assertProjectAccess(ids.alice, ids.orgA, ids.projectA, WRITE_ROLES))
      .resolves.toMatchObject({ id: ids.projectA });
  });

  it("rejects MEMBER mutation access even though another user is OWNER", async () => {
    await prisma.membership.update({ where: aliceInA(), data: { role: MembershipRole.MEMBER } });
    await expect(projects.assertProjectAccess(ids.alice, ids.orgA, ids.projectA, WRITE_ROLES))
      .rejects.toMatchObject(FORBIDDEN);
  });

  it.each([
    ["outsider", ids.outsider, ids.orgA, ids.projectA],
    ["missing organization", ids.owner, ids.missing, ids.projectA],
    ["missing project", ids.owner, ids.orgA, ids.missing],
    ["archived project", ids.owner, ids.orgA, ids.archived],
    ["wrong organization despite ownership of both", ids.owner, ids.orgA, ids.projectB],
  ])("returns the same project error for %s", async (_label, userId, organizationId, projectId) => {
    await expect(projects.assertProjectAccess(userId, organizationId, projectId, READ_ROLES))
      .rejects.toMatchObject(PROJECT_NOT_FOUND);
  });

  it.each(["remove", "demote"] as const)(
    "rejects project access if membership changes between checks: %s", async (change) => {
      const original = organizations.assertOrganizationRole.bind(organizations);
      jest.spyOn(organizations, "assertOrganizationRole").mockImplementationOnce(async (...args) => {
        const membership = await original(...args);
        if (change === "remove") {
          await prisma.membership.delete({ where: aliceInA() });
        } else {
          await prisma.membership.update({ where: aliceInA(), data: { role: MembershipRole.MEMBER } });
        }
        return membership;
      });

      await expect(projects.assertProjectAccess(ids.alice, ids.orgA, ids.projectA, WRITE_ROLES))
        .rejects.toMatchObject(PROJECT_NOT_FOUND);
    },
  );

  it("returns only the intended membership and project fields", async () => {
    const membership = await organizations.assertOrganizationMember(ids.alice, ids.orgA);
    const project = await projects.assertProjectAccess(ids.alice, ids.orgA, ids.projectA, READ_ROLES);

    expect(Object.keys(membership).sort()).toEqual(
      ["id", "organizationId", "userId", "role", "createdAt", "updatedAt"].sort(),
    );
    expect(Object.keys(project).sort()).toEqual(
      ["id", "organizationId", "name", "slug", "description", "archivedAt", "createdAt", "updatedAt"].sort(),
    );
    expect(JSON.stringify({ membership, project })).not.toContain("authorization-test-hash");
  });
});
