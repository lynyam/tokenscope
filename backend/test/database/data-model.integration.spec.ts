import { afterAll, beforeEach, describe, expect, it, } from "@jest/globals";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  Prisma,
  PrismaClient,
} from "../../src/generated/prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

describe("M1 data model", () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects duplicate user emails", async () => {
    const data = {
      email: "alice@test.dev",
      passwordHash: "hash",
      displayName: "Alice",
    };

    await prisma.user.create({ data });

    await expect(
      prisma.user.create({ data }),
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("rejects duplicate membership for the same user and organization", async () => {
    const user = await prisma.user.create({
      data: {
        email: "alice@test.dev",
        passwordHash: "hash",
        displayName: "Alice",
      },
    });

    const organization = await prisma.organization.create({
      data: {
        name: "A.ai",
        slug: "a-ai",
      },
    });

    const membership = {
      userId: user.id,
      organizationId: organization.id,
      role: "OWNER" as const,
    };

    await prisma.membership.create({
      data: membership,
    });

    await expect(
      prisma.membership.create({
        data: membership,
      }),
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("allows the same project slug in different organizations", async () => {
    const organizationA = await prisma.organization.create({
      data: {
        name: "A.ai",
        slug: "a-ai",
      },
    });

    const organizationB = await prisma.organization.create({
      data: {
        name: "B.ai",
        slug: "b-ai",
      },
    });

    await prisma.project.create({
      data: {
        name: "Chatbot",
        slug: "chatbot",
        organizationId: organizationA.id,
      },
    });

    await expect(
      prisma.project.create({
        data: {
          name: "Chatbot",
          slug: "chatbot",
          organizationId: organizationB.id,
        },
      }),
    ).resolves.toBeDefined();
  });

  it("rejects duplicate project slug inside the same organization", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: "A.ai",
        slug: "a-ai",
      },
    });

    const data = {
      name: "Chatbot",
      slug: "chatbot",
      organizationId: organization.id,
    };

    await prisma.project.create({ data });

    await expect(
      prisma.project.create({ data }),
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("rejects a project referencing a nonexistent organization", async () => {
    await expect(
      prisma.project.create({
        data: {
          name: "Invalid",
          slug: "invalid",
          organizationId:
            "00000000-0000-0000-0000-000000000000",
        },
      }),
    ).rejects.toMatchObject({
      code: "P2003",
    });
  });

  it("restricts organization deletion while dependents exist", async () => {
    const user = await prisma.user.create({
      data: {
        email: "alice@test.dev",
        passwordHash: "hash",
        displayName: "Alice",
      },
    });

    const organization = await prisma.organization.create({
      data: {
        name: "A.ai",
        slug: "a-ai",
      },
    });

    await prisma.membership.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        role: "OWNER",
      },
    });

    await expect(
      prisma.organization.delete({
        where: {
          id: organization.id,
        },
      }),
    ).rejects.toMatchObject({
      code: "P2003",
    });
  });

  it("loads organization memberships, users and projects", async () => {
    const alice = await prisma.user.create({
      data: {
        email: "alice@test.dev",
        passwordHash: "hash",
        displayName: "Alice",
      },
    });

    const organization = await prisma.organization.create({
      data: {
        name: "A.ai",
        slug: "a-ai",
      },
    });

    await prisma.membership.create({
      data: {
        userId: alice.id,
        organizationId: organization.id,
        role: "OWNER",
      },
    });

    await prisma.project.create({
      data: {
        name: "Chatbot",
        slug: "chatbot",
        organizationId: organization.id,
      },
    });

    const result = await prisma.organization.findUnique({
      where: {
        id: organization.id,
      },
      include: {
        memberships: {
          include: {
            user: true,
          },
        },
        projects: true,
      },
    });

    expect(result?.memberships).toHaveLength(1);
    expect(result?.memberships[0].user.displayName).toBe(
      "Alice",
    );
    expect(result?.memberships[0].role).toBe("OWNER");
    expect(result?.projects).toHaveLength(1);
    expect(result?.projects[0].slug).toBe("chatbot");
  });
});
