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
import { OrganizationAccessService } from "../../src/memberships/organization-access.service";

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

describe("Memberships with PostgreSQL", () => {
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
          id: ids[name], email: `${name}@memberships.test`,
          displayName: name, passwordHash: hash,
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
          userId: ids.owner, organizationId: ids.orgA, role: "OWNER",
          createdAt: new Date("2026-09-01T00:00:00Z"),
        },
        {
          id: "00000000-0000-4000-8000-000000000003",
          userId: ids.admin, organizationId: ids.orgA, role: "ADMIN",
          createdAt: new Date("2026-09-01T00:00:00Z"),
        },
        {
          id: "00000000-0000-4000-8000-000000000001",
          userId: ids.member, organizationId: ids.orgA, role: "MEMBER",
          createdAt: new Date("2026-09-02T00:00:00Z"),
        },
        { userId: ids.outsider, organizationId: ids.orgB, role: "OWNER" },
        { userId: ids.target, organizationId: ids.orgB, role: "MEMBER" },
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
    expect(result.memberships[0].createdAt).toBe("2026-09-01T00:00:00.000Z");
    expect(JSON.stringify(result)).not.toContain("passwordHash");
    expect(JSON.stringify(result)).not.toContain(hash);
  });

  it.each([
    [ids.outsider, ids.orgA],
    [ids.owner, ids.missing],
  ])("conceals inaccessible or missing organizations", async (actorId, orgId) => {
    await expect(service.list(actorId, orgId)).rejects.toMatchObject({
      status: 404, code: "ORGANIZATION_NOT_FOUND",
    });
  });

  it("adds an existing user using normalized email and the default role", async () => {
    const result = await service.add(
      ids.owner, ids.orgA,
      await input({ email: "  TARGET@Memberships.Test  " }),
    );
    expect(result).toMatchObject({
      userId: ids.target, organizationId: ids.orgA, role: "MEMBER",
      user: { id: ids.target, email: "target@memberships.test", displayName: "target" },
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
        ids.owner, ids.orgA,
        await input({ email: "target@memberships.test", role }),
      );
      expect(result.role).toBe(role);
      const otherMembership = await prisma.membership.findUnique({
        where: {
          organizationId_userId: { organizationId: ids.orgB, userId: ids.target },
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
  ] as const)("rejects actor %s in %s before user lookup", async (actorId, orgId, status, code) => {
    const lookup = jest.spyOn(users, "findSafeByEmail");
    await expect(service.add(
      actorId, orgId, await input({ email: "unknown@memberships.test" }),
    )).rejects.toMatchObject({ status, code });
    expect(lookup).not.toHaveBeenCalled();
    expect(await prisma.membership.count()).toBe(5);
  });

  it("rejects an unregistered user without creating an account", async () => {
    await expect(service.add(
      ids.owner, ids.orgA, await input({ email: "unknown@memberships.test" }),
    )).rejects.toMatchObject({ status: 404, code: "USER_NOT_FOUND" });
    expect(await prisma.user.count()).toBe(5);
    expect(await prisma.membership.count()).toBe(5);
  });

  it("maps the database duplicate conflict without changing the existing role", async () => {
    await expect(service.add(
      ids.owner, ids.orgA, await input({ email: "owner@memberships.test" }),
    )).rejects.toMatchObject({ status: 409, code: "MEMBERSHIP_ALREADY_EXISTS" });
    const original = await prisma.membership.findUnique({
      where: {
        organizationId_userId: { organizationId: ids.orgA, userId: ids.owner },
      },
    });
    expect(original?.role).toBe(MembershipRole.OWNER);
    expect(await prisma.membership.count()).toBe(5);
  });

  const whereMember = (userId: string, organizationId = ids.orgA) => ({
    organizationId_userId: { organizationId, userId },
  });

  type Mutation = "updateRole" | "remove";

  function mutate(
    operation: Mutation,
    actorId: string,
    organizationId: string,
    targetUserId: string,
  ) {
    return operation === "updateRole"
      ? service.updateRole(actorId, organizationId, targetUserId, {
          role: MembershipRole.MEMBER,
        })
      : service.remove(actorId, organizationId, targetUserId);
  }

  it.each(Object.values(MembershipRole))(
    "allows an OWNER to set another member's role to %s", async (role) => {
      const result = await service.updateRole(ids.owner, ids.orgA, ids.admin, { role });
      expect(result).toMatchObject({
        organizationId: ids.orgA, userId: ids.admin, role,
        user: { id: ids.admin, email: "admin@memberships.test", displayName: "admin" },
      });
      expect(JSON.stringify(result)).not.toContain("passwordHash");
      expect(JSON.stringify(result)).not.toContain(hash);
      expect(await prisma.membership.findUnique({ where: whereMember(ids.admin) }))
        .toMatchObject({ role });
    },
  );

  it("keeps an unchanged sole OWNER role and timestamp", async () => {
    const before = await prisma.membership.update({
      where: whereMember(ids.owner),
      data: { updatedAt: new Date("2020-01-01T00:00:00Z") },
    });
    const result = await service.updateRole(ids.owner, ids.orgA, ids.owner, {
      role: MembershipRole.OWNER,
    });
    expect(result.role).toBe(MembershipRole.OWNER);
    expect(result.updatedAt).toBe(before.updatedAt.toISOString());
    expect(await prisma.membership.findUnique({ where: whereMember(ids.owner) }))
      .toEqual(before);
  });

  it("also rejects demoting the last OWNER to ADMIN", async () => {
    await expect(service.updateRole(ids.owner, ids.orgA, ids.owner, {
      role: MembershipRole.ADMIN,
    })).rejects.toMatchObject({ status: 409, code: "LAST_OWNER_REQUIRED" });
    expect(await prisma.membership.findUnique({ where: whereMember(ids.owner) }))
      .toMatchObject({ role: MembershipRole.OWNER });
  });

  describe.each(["updateRole", "remove"] as const)("%s", (operation) => {
    it.each([
      [ids.admin, ids.orgA, 403, "INSUFFICIENT_ORGANIZATION_ROLE"],
      [ids.member, ids.orgA, 403, "INSUFFICIENT_ORGANIZATION_ROLE"],
      [ids.outsider, ids.orgA, 404, "ORGANIZATION_NOT_FOUND"],
      [ids.owner, ids.missing, 404, "ORGANIZATION_NOT_FOUND"],
    ] as const)("checks actor %s in %s before the target", async (actorId, orgId, status, code) => {
      const before = await prisma.membership.findMany({ orderBy: { id: "asc" } });
      await expect(mutate(operation, actorId, orgId, ids.missing))
        .rejects.toMatchObject({ status, code });
      expect(await prisma.membership.findMany({ orderBy: { id: "asc" } }))
        .toEqual(before);
    });

    it.each([ids.target, ids.missing])(
      "rejects a target without membership in this organization: %s", async (userId) => {
        const before = await prisma.membership.findMany({ orderBy: { id: "asc" } });
        await expect(mutate(operation, ids.owner, ids.orgA, userId))
          .rejects.toMatchObject({ status: 404, code: "MEMBERSHIP_NOT_FOUND" });
        expect(await prisma.membership.findMany({ orderBy: { id: "asc" } }))
          .toEqual(before);
      },
    );

    it("preserves the last OWNER even though another organization has an OWNER", async () => {
      const before = await prisma.membership.findUnique({ where: whereMember(ids.owner) });
      await expect(mutate(operation, ids.owner, ids.orgA, ids.owner))
        .rejects.toMatchObject({ status: 409, code: "LAST_OWNER_REQUIRED" });
      expect(await prisma.membership.findUnique({ where: whereMember(ids.owner) }))
        .toEqual(before);
    });

    it("allows the caller to leave ownership when another OWNER remains", async () => {
      await service.updateRole(ids.owner, ids.orgA, ids.admin, {
        role: MembershipRole.OWNER,
      });
      await mutate(operation, ids.owner, ids.orgA, ids.owner);

      const owners = await prisma.membership.findMany({
        where: { organizationId: ids.orgA, role: MembershipRole.OWNER },
      });
      expect(owners.map((m) => m.userId)).toEqual([ids.admin]);
      expect(await prisma.user.count()).toBe(5);

      const formerOwner = await prisma.membership.findUnique({ where: whereMember(ids.owner) });
      if (operation === "remove") {
        expect(formerOwner).toBeNull();
      } else {
        expect(formerOwner?.role).toBe(MembershipRole.MEMBER);
      }

      await expect(mutate(operation, ids.owner, ids.orgA, ids.member))
        .rejects.toMatchObject(operation === "remove"
          ? { status: 404, code: "ORGANIZATION_NOT_FOUND" }
          : { status: 403, code: "INSUFFICIENT_ORGANIZATION_ROLE" });
    });
  });

  it.each([MembershipRole.ADMIN, MembershipRole.MEMBER])(
    "removes a %s membership while preserving the user and other memberships", async (role) => {
      await service.add(ids.owner, ids.orgA, await input({
        email: "target@memberships.test", role,
      }));
      const otherMembership = await prisma.membership.findUnique({
        where: whereMember(ids.target, ids.orgB),
      });
      await expect(service.remove(ids.owner, ids.orgA, ids.target)).resolves.toBeUndefined();
      expect(await prisma.membership.findUnique({ where: whereMember(ids.target) }))
        .toBeNull();
      expect(await prisma.membership.findUnique({ where: whereMember(ids.target, ids.orgB) }))
        .toEqual(otherMembership);
      expect(await prisma.user.findUnique({ where: { id: ids.target } })).not.toBeNull();
      expect(await prisma.user.count()).toBe(5);
    },
  );

  // Pause the first two calls; retries pass through immediately.
  function twoPartyBarrier() {
    let arrivals = 0;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });

    return async () => {
      arrivals += 1;
      if (arrivals > 2) return;
      if (arrivals === 2) release();

      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          ready,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Transactions did not overlap")), 2000);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    };
  }

  it.each([
    ["remove", "remove"],
    ["updateRole", "updateRole"],
    ["remove", "updateRole"],
  ] as const)("preserves an OWNER during concurrent %s / %s", async (first, second) => {
    await service.updateRole(ids.owner, ids.orgA, ids.admin, {
      role: MembershipRole.OWNER,
    });

    const access = context.get(OrganizationAccessService);
    const original = access.assertOrganizationRole.bind(access);
    const waitForBoth = twoPartyBarrier();
    const authorize = jest.spyOn(access, "assertOrganizationRole")
      .mockImplementation(async (...args) => {
        const actor = await original(...args);
        // Both real transactions have read their actor before either can write.
        await waitForBoth();
        return actor;
      });

    const results = await Promise.allSettled([
      mutate(first, ids.owner, ids.orgA, ids.owner),
      mutate(second, ids.admin, ids.orgA, ids.admin),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toMatchObject({ status: 409, code: "LAST_OWNER_REQUIRED" });
    // Two first attempts plus at least one complete retry, including authorization.
    expect(authorize.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(await prisma.membership.count({
      where: { organizationId: ids.orgA, role: MembershipRole.OWNER },
    })).toBe(1);
    expect(await prisma.membership.findUnique({ where: whereMember(ids.outsider, ids.orgB) }))
      .toMatchObject({ role: MembershipRole.OWNER });
    expect(await prisma.user.count()).toBe(5);
  }, 10000);
});
