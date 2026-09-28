import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import { ConfigurationModule } from "../../src/config/configuration.module";
import { createValidationPipe } from "../../src/common/validation/create-validation";
import { PrismaService } from "../../src/database/prisma.service";
import { MembershipRole } from "../../src/generated/prisma/client";
import { UsersService } from "../../src/users/users.service";
import { AddMemberDto } from "../../src/memberships/dto/add-member.dto";
import { MembershipsModule } from "../../src/memberships/memberships.module";
import { MembershipsService } from "../../src/memberships/memberships.service";

const ids = {
  owner: randomUUID(), admin: randomUUID(), member: randomUUID(),
  outsider: randomUUID(), target: randomUUID(),
  orgA: randomUUID(), orgB: randomUUID(), missing: randomUUID(),
};

const hash = "HASH_MUST_STAY_PRIVATE";
const pipe = createValidationPipe();

function input(body: Record<string, unknown>): Promise<AddMemberDto> {
  return pipe.transform(body, { type: "body", metatype: AddMemberDto });
}

describe("Membership list and add with PostgreSQL", () => {
  let context: TestingModule;
  let prisma: PrismaService;
  let service: MembershipsService;
  let users: UsersService;

  beforeAll(async () => {
    context = await Test.createTestingModule({
      imports: [ConfigurationModule, MembershipsModule],
    }).compile();

    await context.init();

    prisma = context.get(PrismaService);
    service = context.get(MembershipsService);
    users = context.get(UsersService);
  });

  beforeEach(async () => {
    // The existing Jest setup restricts this suite to the isolated test DB.
    await prisma.project.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.createMany({
      data: (["owner", "admin", "member", "outsider", "target"] as const)
        .map((name) => ({
          id: ids[name],
          email: `${name}@memberships.test`,
          displayName: name,
          passwordHash: hash,
        })),
    });

    await prisma.organization.createMany({
      data: [
        { id: ids.orgA, name: "A", slug: "membership-test-a" },
        { id: ids.orgB, name: "B", slug: "membership-test-b" },
      ],
    });

    await prisma.membership.createMany({
      data: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          userId: ids.owner,
          organizationId: ids.orgA,
          role: "OWNER",
          createdAt: new Date("2026-09-01T00:00:00Z"),
        },
        {
          id: "00000000-0000-4000-8000-000000000003",
          userId: ids.admin,
          organizationId: ids.orgA,
          role: "ADMIN",
          createdAt: new Date("2026-09-01T00:00:00Z"),
        },
        {
          id: "00000000-0000-4000-8000-000000000001",
          userId: ids.member,
          organizationId: ids.orgA,
          role: "MEMBER",
          createdAt: new Date("2026-09-02T00:00:00Z"),
        },
        {
          userId: ids.outsider,
          organizationId: ids.orgB,
          role: "OWNER",
        },
        {
          userId: ids.target,
          organizationId: ids.orgB,
          role: "MEMBER",
        },
      ],
    });
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await context?.close(); });

  it.each([
    [ids.owner, MembershipRole.OWNER],
    [ids.admin, MembershipRole.ADMIN],
    [ids.member, MembershipRole.MEMBER],
  ])("lists safely for actor %s with role %s", async (actorId, role) => {
    const result = await service.list(actorId, ids.orgA);

    expect(result.currentUserRole).toBe(role);
    expect(result.memberships.map((m) => m.userId))
      .toEqual([ids.owner, ids.admin, ids.member]);
    expect(result.memberships.every((m) => m.organizationId === ids.orgA))
      .toBe(true);
    expect(result.memberships[0].createdAt)
      .toBe("2026-09-01T00:00:00.000Z");

    expect(JSON.stringify(result)).not.toContain("passwordHash");
    expect(JSON.stringify(result)).not.toContain(hash);
  });

  it.each([
    [ids.outsider, ids.orgA],
    [ids.owner, ids.missing],
  ])("conceals inaccessible or missing organizations", async (actorId, orgId) => {
    await expect(service.list(actorId, orgId)).rejects.toMatchObject({
      status: 404,
      code: "ORGANIZATION_NOT_FOUND",
    });
  });

  it("adds an existing user using normalized email and the default role", async () => {
    const result = await service.add(
      ids.owner,
      ids.orgA,
      await input({ email: "  TARGET@Memberships.Test  " }),
    );

    expect(result).toMatchObject({
      userId: ids.target,
      organizationId: ids.orgA,
      role: "MEMBER",
      user: {
        id: ids.target,
        email: "target@memberships.test",
        displayName: "target",
      },
    });

    expect(JSON.stringify(result)).not.toContain("passwordHash");
    expect(JSON.stringify(result)).not.toContain(hash);

    expect(await prisma.membership.count({
      where: { userId: ids.target },
    })).toBe(2);

    expect(await prisma.user.count()).toBe(5);
  });

  it.each([MembershipRole.OWNER, MembershipRole.ADMIN])(
    "allows an OWNER to add a user as %s", async (role) => {
      const result = await service.add(
        ids.owner,
        ids.orgA,
        await input({ email: "target@memberships.test", role }),
      );

      expect(result.role).toBe(role);

      const otherMembership = await prisma.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: ids.orgB,
            userId: ids.target,
          },
        },
      });

      expect(otherMembership?.role).toBe(MembershipRole.MEMBER);
    },
  );

  it.each([
    [ids.admin, ids.orgA, 403, "INSUFFICIENT_ORGANIZATION_ROLE"],
    [ids.member, ids.orgA, 403, "INSUFFICIENT_ORGANIZATION_ROLE"],
    [ids.outsider, ids.orgA, 404, "ORGANIZATION_NOT_FOUND"],
    [ids.owner, ids.missing, 404, "ORGANIZATION_NOT_FOUND"],
  ] as const)(
    "rejects actor %s in %s before user lookup",
    async (actorId, orgId, status, code) => {
      const lookup = jest.spyOn(users, "findSafeByEmail");

      await expect(service.add(
        actorId,
        orgId,
        await input({ email: "unknown@memberships.test" }),
      )).rejects.toMatchObject({ status, code });

      expect(lookup).not.toHaveBeenCalled();
      expect(await prisma.membership.count()).toBe(5);
    },
  );

  it("rejects an unregistered user without creating an account", async () => {
    await expect(service.add(
      ids.owner,
      ids.orgA,
      await input({ email: "unknown@memberships.test" }),
    )).rejects.toMatchObject({
      status: 404,
      code: "USER_NOT_FOUND",
    });

    expect(await prisma.user.count()).toBe(5);
    expect(await prisma.membership.count()).toBe(5);
  });

  it("maps the database duplicate conflict without changing the existing role", async () => {
    await expect(service.add(
      ids.owner,
      ids.orgA,
      await input({ email: "owner@memberships.test" }),
    )).rejects.toMatchObject({
      status: 409,
      code: "MEMBERSHIP_ALREADY_EXISTS",
    });

    const original = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: ids.orgA,
          userId: ids.owner,
        },
      },
    });

    expect(original?.role).toBe(MembershipRole.OWNER);
    expect(await prisma.membership.count()).toBe(5);
  });
});
