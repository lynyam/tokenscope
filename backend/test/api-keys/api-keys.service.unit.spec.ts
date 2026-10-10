import { ApiKeysService } from "../../src/api-keys/api-keys.service";
import { PrismaService } from "../../src/database/prisma.service";
import { ProjectAccessService } from "../../src/projects/project-access.service";
import { ApiException } from "../../src/common/errors/api.exception";
import { hashApiKey } from "../../src/api-keys/api-key-secret";

const date = new Date("2026-10-01T00:00:00Z");

function fixture() {
	const row = {
		id: "key-id",
		projectId: "project",
		name: "Writer",
		keyPrefix: "tsk_example1",
		createdAt: date,
		lastUsedAt: null,
		revokedAt: null,
	};

	const tx = {
		apiKey: {
			create: jest.fn().mockResolvedValue(row),
			findMany: jest.fn().mockResolvedValue([row]),
			findFirst: jest.fn().mockResolvedValue({
				id: row.id,
				revokedAt: null,
			}),
			updateMany: jest.fn().mockResolvedValue({ count: 1 }),
		},
	};

	const transaction = jest.fn(
		async (operation: (client: typeof tx) => Promise<unknown>) =>
			operation(tx),
	);

	const access = {
		assertProjectAccess: jest.fn().mockResolvedValue({
			id: "project",
		}),
	};

	const service = new ApiKeysService(
		{ $transaction: transaction } as unknown as PrismaService,
		access as unknown as ProjectAccessService,
	);

	return { service, tx, access, transaction, row };
}

const conflict = () => ({
	name: "DriverAdapterError",
	cause: { kind: "TransactionWriteConflict" },
});

describe("API-key management service", () => {
	it("persists a digest and maps the one-time response", async () => {
		const f = fixture();
		const response = await f.service.create(
			"actor", "org", "project", { name: "Writer" },
		);

		const data = f.tx.apiKey.create.mock.calls[0][0].data;

		expect(data).toMatchObject({
			projectId: "project",
			createdByUserId: "actor",
			keyHash: hashApiKey(response.key),
			keyPrefix: response.key.slice(0, 12),
		});
		expect(data).not.toHaveProperty("key");
		expect(response).not.toHaveProperty("keyHash");
		expect(response).not.toHaveProperty("createdByUserId");

		expect(f.access.assertProjectAccess).toHaveBeenCalledWith(
			"actor", "org", "project", ["OWNER", "ADMIN"], f.tx,
		);
	});

	it("uses the transaction for authorization and list reads", async () => {
		const f = fixture();
		const result = await f.service.list("actor", "org", "project");

		expect(f.access.assertProjectAccess).toHaveBeenCalledWith(
			"actor", "org", "project", ["OWNER", "ADMIN"], f.tx,
		);
		expect(f.tx.apiKey.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { projectId: "project" },
				orderBy: [{ createdAt: "desc" }, { id: "asc" }],
			}),
		);
		expect(result[0]).not.toHaveProperty("key");
		expect(result[0]).not.toHaveProperty("keyHash");
	});

	it("authorizes again but does not rewrite an existing revocation", async () => {
		const f = fixture();
		f.tx.apiKey.findFirst.mockResolvedValueOnce({
			id: "key-id",
			revokedAt: date,
		});

		await f.service.revoke("actor", "org", "project", "key-id");

		expect(f.access.assertProjectAccess).toHaveBeenCalledTimes(1);
		expect(f.tx.apiKey.updateMany).not.toHaveBeenCalled();
	});

	it("scopes revocation to the project", async () => {
		const f = fixture();

		await f.service.revoke("actor", "org", "project", "key-id");

		expect(f.tx.apiKey.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "key-id", projectId: "project" },
			}),
		);
		expect(f.tx.apiKey.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					id: "key-id",
					projectId: "project",
					revokedAt: null,
				},
			}),
		);
	});

	it("does not mutate when authorization fails", async () => {
		const f = fixture();
		const failure = new ApiException(403, "FORBIDDEN", "Denied.");
		f.access.assertProjectAccess.mockRejectedValueOnce(failure);

		await expect(
			f.service.create("actor", "org", "project", { name: "Writer" }),
		).rejects.toBe(failure);

		expect(f.tx.apiKey.create).not.toHaveBeenCalled();
		expect(f.transaction).toHaveBeenCalledTimes(1);
	});

	it("repeats authorization after a transaction conflict", async () => {
		const f = fixture();
		f.tx.apiKey.create.mockRejectedValueOnce(conflict());

		await f.service.create(
			"actor", "org", "project", { name: "Writer" },
		);

		expect(f.transaction).toHaveBeenCalledTimes(2);
		expect(f.access.assertProjectAccess).toHaveBeenCalledTimes(2);
	});

	it("honors changed authorization on retry", async () => {
		const f = fixture();
		f.tx.apiKey.create.mockRejectedValueOnce(conflict());
		f.access.assertProjectAccess
			.mockResolvedValueOnce({ id: "project" })
			.mockRejectedValueOnce(
				new ApiException(403, "FORBIDDEN", "Denied."),
			);

		await expect(
			f.service.create("actor", "org", "project", { name: "Writer" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });

		expect(f.tx.apiKey.create).toHaveBeenCalledTimes(1);
	});

	it("returns CONCURRENT_MODIFICATION after three attempts", async () => {
		const f = fixture();
		f.tx.apiKey.create.mockRejectedValue(conflict());

		await expect(
			f.service.create("actor", "org", "project", { name: "Writer" }),
		).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });

		expect(f.transaction).toHaveBeenCalledTimes(3);
		expect(f.access.assertProjectAccess).toHaveBeenCalledTimes(3);
	});

	it("does not retry unexpected persistence errors", async () => {
		const f = fixture();
		const failure = new Error("database unavailable");
		f.tx.apiKey.create.mockRejectedValueOnce(failure);

		await expect(
			f.service.create("actor", "org", "project", { name: "Writer" }),
		).rejects.toBe(failure);

		expect(f.transaction).toHaveBeenCalledTimes(1);
	});
});
