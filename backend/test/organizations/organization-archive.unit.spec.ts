import "reflect-metadata";
import { HttpStatus } from "@nestjs/common";
import { ApiException } from "../../src/common/errors/api.exception";
import type { PrismaService } from "../../src/database/prisma.service";
import { MembershipRole, Prisma } from "../../src/generated/prisma/client";
import { OrganizationAccessService } from "../../src/memberships/organization-access.service";
import type { ArchiveOrganizationDto } from "../../src/organizations/dto/archive-organization.dto";
import { OrganizationsService } from "../../src/organizations/organizations.service";

function adapterError(kind: string): Error {
  return Object.assign(new Error(kind), {
    name: "DriverAdapterError",
    cause: { kind },
  });
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("Test database error", {
    code,
    clientVersion: "test",
  });
}

// Captures the expected ApiException so status and code can be asserted.
async function failure(call: Promise<unknown>): Promise<ApiException> {
  try {
    await call;
  } catch (error) {
    return error as ApiException;
  }
  throw new Error("Expected the call to be rejected.");
}
const statusOf = (error: ApiException) => error.getStatus();
const codeOf = (error: ApiException) => error.code;

const dto = (confirmSlug: string) => ({ confirmSlug }) as ArchiveOrganizationDto;

function setup() {
  const organization = {
    findFirst: jest.fn().mockResolvedValue({ slug: "acme" }),
    update: jest.fn().mockResolvedValue({}),
  };
  // Children must never be touched: any call on these would fail the tests.
  const membership = { deleteMany: jest.fn(), updateMany: jest.fn() };
  const project = { deleteMany: jest.fn(), updateMany: jest.fn() };
  const tx = { organization, membership, project } as unknown as Prisma.TransactionClient;

  const authorize = jest.fn().mockResolvedValue(undefined);
  const transaction = jest.fn<
    Promise<unknown>,
    [
      (client: Prisma.TransactionClient) => Promise<unknown>,
      { isolationLevel: Prisma.TransactionIsolationLevel },
    ]
  >();
  transaction.mockImplementation((operation) => operation(tx));

  const service = new OrganizationsService(
    { $transaction: transaction } as unknown as PrismaService,
    { assertOrganizationRole: authorize } as unknown as OrganizationAccessService,
  );

  const archive = (confirmSlug = "acme") =>
    service.archive("owner", "org", dto(confirmSlug));

  return { organization, membership, project, tx, authorize, transaction, archive };
}

describe("Organization archive", () => {
  describe("access checks", () => {
    it("rejects a membership whose organization is archived", async () => {
      // The database filter hides the archived organization, so no row is found.
      const findUnique = jest.fn().mockResolvedValue(null);
      const access = new OrganizationAccessService({
        membership: { findUnique },
      } as unknown as PrismaService);

      const error = await failure(
        access.assertOrganizationRole("user", "org", [MembershipRole.OWNER]),
      );

      expect(statusOf(error)).toBe(HttpStatus.NOT_FOUND);
      expect(codeOf(error)).toBe("ORGANIZATION_NOT_FOUND");
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId_userId: { organizationId: "org", userId: "user" },
            organization: { archivedAt: null },
          }),
        }),
      );
    });
  });

  describe("authorization and confirmation", () => {
    it.each([
      ["an ADMIN or MEMBER", HttpStatus.FORBIDDEN, "INSUFFICIENT_ORGANIZATION_ROLE"],
      ["an outsider", HttpStatus.NOT_FOUND, "ORGANIZATION_NOT_FOUND"],
    ] as const)("does not let %s archive", async (_label, status, code) => {
      const { organization, authorize, transaction, archive } = setup();
      authorize.mockRejectedValue(new ApiException(status, code, "Denied."));

      const error = await failure(archive());

      expect(statusOf(error)).toBe(status);
      expect(codeOf(error)).toBe(code);
      // Authorization fails before the slug is read or compared.
      expect(organization.findFirst).not.toHaveBeenCalled();
      expect(organization.update).not.toHaveBeenCalled();
      expect(transaction).toHaveBeenCalledTimes(1); // Permission failures are not retried.
    });

    it.each(["Acme", "acme ", " acme", "ACME", ""])(
      "performs no update for the incorrect confirmation %j",
      async (wrong) => {
        const { organization, archive } = setup();

        const error = await failure(archive(wrong));

        expect(statusOf(error)).toBe(HttpStatus.CONFLICT);
        expect(codeOf(error)).toBe("ORGANIZATION_CONFIRMATION_MISMATCH");
        expect(organization.update).not.toHaveBeenCalled();
      },
    );

    it("returns 404 when the organization is already archived", async () => {
      const { organization, archive } = setup();
      organization.findFirst.mockResolvedValue(null);

      const error = await failure(archive());

      expect(statusOf(error)).toBe(HttpStatus.NOT_FOUND);
      expect(codeOf(error)).toBe("ORGANIZATION_NOT_FOUND");
      expect(organization.update).not.toHaveBeenCalled();
    });
  });

  describe("successful archive", () => {
    it("sets only the archive timestamp and leaves children untouched", async () => {
      const { organization, membership, project, authorize, transaction, archive } = setup();

      await expect(archive()).resolves.toBeUndefined();

      expect(authorize).toHaveBeenCalledWith(
        "owner", "org", [MembershipRole.OWNER], expect.anything(),
      );
      expect(transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }),
      );
      expect(organization.update).toHaveBeenCalledTimes(1);
      const call = organization.update.mock.calls[0][0];
      // The final write stays scoped to the active organization and the OWNER actor.
      expect(call.where).toMatchObject({
        id: "org",
        archivedAt: null,
        memberships: { some: { userId: "owner", role: MembershipRole.OWNER } },
      });
      expect(Object.keys(call.data)).toEqual(["archivedAt"]);
      expect(call.data.archivedAt).toBeInstanceOf(Date);

      expect(membership.deleteMany).not.toHaveBeenCalled();
      expect(membership.updateMany).not.toHaveBeenCalled();
      expect(project.deleteMany).not.toHaveBeenCalled();
      expect(project.updateMany).not.toHaveBeenCalled();
    });

    it("maps a lost race on the final update to 404 without retrying", async () => {
      const { organization, transaction, archive } = setup();
      organization.update.mockRejectedValue(prismaError("P2025"));

      const error = await failure(archive());

      expect(statusOf(error)).toBe(HttpStatus.NOT_FOUND);
      expect(codeOf(error)).toBe("ORGANIZATION_NOT_FOUND");
      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("transaction conflicts", () => {
    const conflicts = [
      ["Prisma P2034", () => prismaError("P2034")],
      ["direct adapter conflict", () => adapterError("TransactionWriteConflict")],
    ] as const;

    // Runs the real operation for each attempt, then reports a conflict.
    const conflictThenCommit = (
      transaction: ReturnType<typeof setup>["transaction"],
      tx: Prisma.TransactionClient,
      makeError: () => Error,
      failingAttempts: number,
    ) => {
      let attempts = 0;
      transaction.mockImplementation(async (operation) => {
        attempts += 1;
        const result = await operation(tx);
        if (attempts <= failingAttempts) throw makeError();
        return result;
      });
    };

    it.each(conflicts)(
      "retries after a %s with a fresh authorization",
      async (_label, makeError) => {
        const { tx, authorize, transaction, organization, archive } = setup();
        conflictThenCommit(transaction, tx, makeError, 1);

        await expect(archive()).resolves.toBeUndefined();

        expect(transaction).toHaveBeenCalledTimes(2);
        expect(authorize).toHaveBeenCalledTimes(2); // Re-authorized on every attempt.
        expect(organization.update).toHaveBeenCalledTimes(2);
      },
    );

    it.each(conflicts)(
      "returns CONCURRENT_MODIFICATION after three attempts on a %s",
      async (_label, makeError) => {
        const { tx, authorize, transaction, archive } = setup();
        conflictThenCommit(transaction, tx, makeError, Number.POSITIVE_INFINITY);

        const error = await failure(archive());

        expect(statusOf(error)).toBe(HttpStatus.CONFLICT);
        expect(codeOf(error)).toBe("CONCURRENT_MODIFICATION");
        expect(transaction).toHaveBeenCalledTimes(3);
        expect(authorize).toHaveBeenCalledTimes(3);
      },
    );

    it.each([
      ["an unknown error", () => new Error("boom")],
      ["another Prisma error", () => prismaError("P2002")],
      ["a non-conflict adapter error", () => adapterError("SomethingElse")],
    ] as const)("propagates %s without retrying", async (_label, makeError) => {
      const { transaction, archive } = setup();
      const thrown = makeError();
      transaction.mockRejectedValue(thrown);

      await expect(archive()).rejects.toBe(thrown);
      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });
});