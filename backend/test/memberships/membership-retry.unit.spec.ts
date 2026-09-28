import "reflect-metadata";
import { ApiException } from "../../src/common/errors/api.exception";
import type { PrismaService } from "../../src/database/prisma.service";
import { MembershipRole, Prisma } from "../../src/generated/prisma/client";
import { MembershipsService } from "../../src/memberships/memberships.service";
import type { OrganizationAccessService } from "../../src/memberships/organization-access.service";
import type { UsersService } from "../../src/users/users.service";

function adapterError(kind: string): Error {
	return Object.assign(new Error(kind), {
		name: "DriverAdapterError",
		cause: { kind },
	});
}

function prismaError(code: string) {
	return new Prisma.PrismaClientKnownRequestError(
		"Test database error",
		{ code, clientVersion: "test" },
	);
}

function setup() {
	const target = {
		id: "membership",
		userId: "owner",
		organizationId: "org",
		role: MembershipRole.OWNER,
		createdAt: new Date("2026-09-01T00:00:00Z"),
		updatedAt: new Date("2026-09-01T00:00:00Z"),
		user: {
			id: "owner",
			email: "owner@test.example",
			displayName: "Owner",
		},
	};

	const membership = {
		findUnique: jest.fn().mockResolvedValue(target),
		count: jest.fn().mockResolvedValue(2),
		update: jest.fn().mockResolvedValue({
			...target,
			role: MembershipRole.MEMBER,
		}),
	};

	const tx = { membership } as unknown as Prisma.TransactionClient;
	const authorize = jest.fn().mockResolvedValue(target);

	const transaction = jest.fn<
		Promise<unknown>,
		[
			(client: Prisma.TransactionClient) => Promise<unknown>,
			{ isolationLevel: Prisma.TransactionIsolationLevel },
		]
	>();

	const service = new MembershipsService(
		{ $transaction: transaction } as unknown as PrismaService,
		{
			assertOrganizationRole: authorize,
		} as unknown as OrganizationAccessService,
		{} as UsersService,
	);

	const demote = () =>
		service.updateRole("owner", "org", "owner", {
			role: MembershipRole.MEMBER,
		});

	return { membership, tx, authorize, transaction, demote };
}

describe("Membership transaction retries", () => {
	const conflicts = [
		["Prisma P2034", () => prismaError("P2034")],
		[
			"direct adapter conflict",
			() => adapterError("TransactionWriteConflict"),
		],
	] as const;

	it.each(conflicts)(
		"rechecks authorization and owners after %s",
		async (_label, createError) => {
			const {
				membership,
				tx,
				authorize,
				transaction,
				demote,
			} = setup();

			// First attempt: two owners.
			// Retry: the other request has committed, leaving one.
			membership.count
				.mockResolvedValue(1)
				.mockResolvedValueOnce(2);

			const conflict = createError();
			let attempts = 0;

			transaction.mockImplementation(async (operation) => {
				attempts += 1;
				const result = await operation(tx);

				// Simulate a conflict at COMMIT,
				// after the transaction callback finished.
				if (attempts === 1) throw conflict;

				return result;
			});

			await expect(demote()).rejects.toMatchObject({
				status: 409,
				code: "LAST_OWNER_REQUIRED",
			});

			expect(transaction).toHaveBeenCalledTimes(2);
			expect(authorize).toHaveBeenCalledTimes(2);
			expect(membership.findUnique).toHaveBeenCalledTimes(2);
			expect(membership.count).toHaveBeenCalledTimes(2);
			expect(membership.update).toHaveBeenCalledTimes(1);

			expect(authorize).toHaveBeenLastCalledWith(
				"owner",
				"org",
				[MembershipRole.OWNER],
				tx,
			);

			for (const [, options] of transaction.mock.calls) {
				expect(options.isolationLevel).toBe(
					Prisma.TransactionIsolationLevel.Serializable,
				);
			}
		},
	);

	it.each(conflicts)(
		"stops after three attempts for %s",
		async (_label, createError) => {
			const { transaction, demote } = setup();
			const conflict = createError();

			transaction.mockRejectedValue(conflict);

			await expect(demote()).rejects.toBe(conflict);
			expect(transaction).toHaveBeenCalledTimes(3);
		},
	);

	it.each([
		[
			"business rejection",
			new ApiException(
				409,
				"LAST_OWNER_REQUIRED",
				"Owner required.",
			),
		],
		["Prisma unique violation", prismaError("P2002")],
		[
			"matching message only",
			new Error("TransactionWriteConflict"),
		],
		[
			"unrelated adapter error",
			adapterError("UniqueConstraintViolation"),
		],
	])("does not retry %s", async (_label, error) => {
		const { transaction, demote } = setup();

		transaction.mockRejectedValue(error);

		await expect(demote()).rejects.toBe(error);
		expect(transaction).toHaveBeenCalledTimes(1);
	});
});
