import "reflect-metadata";

import {
  MembershipRole,
  type Prisma,
} from "../../src/generated/prisma/client";

import { PrismaService } from "../../src/database/prisma.service";
import { OrganizationAccessService } from "../../src/memberships/organization-access.service";
import { ProjectAccessService } from "../../src/projects/project-access.service";

const roles = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
];

const member = {
  userId: "actor",
  organizationId: "org",
  role: MembershipRole.OWNER,
};

const project = {
  id: "project",
  organizationId: "org",
};

function databaseDouble() {
  return {
    membership: {
      findUnique: jest.fn().mockResolvedValue(member),
    },
    project: {
      findFirst: jest.fn().mockResolvedValue(project),
    },
  };
}

describe("Transaction-aware project access", () => {
  const root = databaseDouble();
  const tx = databaseDouble();

  const rootClient = root as unknown as PrismaService;
  const txClient = tx as unknown as Prisma.TransactionClient;

  const organizations = new OrganizationAccessService(rootClient);
  const projects = new ProjectAccessService(rootClient, organizations);

  beforeEach(() => {
    jest.clearAllMocks();

    for (const db of [root, tx]) {
      db.membership.findUnique.mockReset().mockResolvedValue(member);
      db.project.findFirst.mockReset().mockResolvedValue(project);
    }
  });

  it.each([false, true])(
    "uses one client for every read (transaction=%s)",
    async transactional => {
      await expect(
        projects.assertProjectAccess(
          "actor",
          "org",
          "project",
          roles,
          transactional ? txClient : undefined,
        ),
      ).resolves.toBe(project);

      const used = transactional ? tx : root;
      const unused = transactional ? root : tx;

      expect(unused.membership.findUnique).not.toHaveBeenCalled();
      expect(unused.project.findFirst).not.toHaveBeenCalled();

      expect(used.membership.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId_userId: {
              organizationId: "org",
              userId: "actor",
            },
            organization: {
              archivedAt: null,
            },
          },
        }),
      );

      expect(used.project.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "project",
            organizationId: "org",
            archivedAt: null,
            organization: {
              archivedAt: null,
              memberships: {
                some: {
                  userId: "actor",
                  role: {
                    in: roles,
                  },
                },
              },
            },
          },
        }),
      );
    },
  );

  it("preserves 403 before looking up the project", async () => {
    tx.membership.findUnique.mockResolvedValue({
      ...member,
      role: MembershipRole.MEMBER,
    });

    await expect(
      projects.assertProjectAccess(
        "actor",
        "org",
        "project",
        roles,
        txClient,
      ),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_ORGANIZATION_ROLE",
      status: 403,
    });

    expect(tx.project.findFirst).not.toHaveBeenCalled();
  });

  it("maps inaccessible organizations to the scoped project error", async () => {
    tx.membership.findUnique.mockResolvedValue(null);

    await expect(
      projects.assertProjectAccess(
        "actor",
        "org",
        "project",
        roles,
        txClient,
      ),
    ).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
      status: 404,
    });

    expect(tx.project.findFirst).not.toHaveBeenCalled();
  });

  it("does not disguise a database failure as a missing resource", async () => {
    const failure = new Error("database unavailable");

    tx.project.findFirst.mockRejectedValue(failure);

    await expect(
      projects.assertProjectAccess(
        "actor",
        "org",
        "project",
        roles,
        txClient,
      ),
    ).rejects.toBe(failure);
  });
});
