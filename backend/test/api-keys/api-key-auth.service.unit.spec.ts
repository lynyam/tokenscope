import { Logger } from "@nestjs/common";
import { ApiKeyAuthService } from "../../src/api-keys/api-key-auth.service";
import {
	generateApiKeySecret,
	hashApiKey,
} from "../../src/api-keys/api-key-secret";
import { PrismaService } from "../../src/database/prisma.service";
import type { Prisma } from "../../src/generated/prisma/client";

function fixture() {
	const apiKey = {
		findFirst: jest.fn().mockResolvedValue({
			id: "key-id",
			projectId: "project",
		}),
		updateMany: jest.fn().mockResolvedValue({ count: 1 }),
	};

	const service = new ApiKeyAuthService(
		{ apiKey } as unknown as PrismaService,
	);

	return { service, apiKey };
}

describe("API-key authentication", () => {
	afterEach(() => jest.restoreAllMocks());

	it("requires hash, revocation and both active parents", async () => {
		const f = fixture();
		const { key } = generateApiKeySecret();

		const principal = await f.service.authenticate(key);

		expect(f.apiKey.findFirst).toHaveBeenCalledWith({
			where: {
				keyHash: hashApiKey(key),
				revokedAt: null,
				project: {
					archivedAt: null,
					organization: { archivedAt: null },
				},
			},
			select: { id: true, projectId: true },
		});
		expect(principal).toEqual({
			keyId: "key-id",
			projectId: "project",
		});
		expect(Object.isFrozen(principal)).toBe(true);
	});

	it("rejects malformed keys without a database read", async () => {
		const f = fixture();

		await expect(
			f.service.authenticate("not-a-key"),
		).rejects.toMatchObject({ code: "INVALID_API_KEY" });

		expect(f.apiKey.findFirst).not.toHaveBeenCalled();
	});

	it("uses the same invalid-key error for a missing match", async () => {
		const f = fixture();
		f.apiKey.findFirst.mockResolvedValueOnce(null);

		await expect(
			f.service.authenticate(generateApiKeySecret().key),
		).rejects.toMatchObject({
			code: "INVALID_API_KEY",
			publicMessage: "The provided API key is invalid.",
		});
	});

	it("propagates database failures", async () => {
		const f = fixture();
		const failure = new Error("database failure");
		f.apiKey.findFirst.mockRejectedValueOnce(failure);

		await expect(
			f.service.authenticate(generateApiKeySecret().key),
		).rejects.toBe(failure);
	});

	it("revalidates both trusted IDs using only the supplied transaction", async () => {
		const f = fixture();
		const findFirst = jest.fn().mockResolvedValue({ id: "key-id" });
		const tx = {
			apiKey: { findFirst },
		} as unknown as Prisma.TransactionClient;

		await f.service.assertActivePrincipal(
			{ keyId: "key-id", projectId: "project" },
			tx,
		);

		expect(f.apiKey.findFirst).not.toHaveBeenCalled();
		expect(findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					id: "key-id",
					projectId: "project",
					revokedAt: null,
					project: {
						archivedAt: null,
						organization: { archivedAt: null },
					},
				},
			}),
		);
	});

	it("rejects a principal that has lost access", async () => {
		const f = fixture();
		f.apiKey.findFirst.mockResolvedValueOnce(null);

		await expect(
			f.service.assertActivePrincipal({
				keyId: "key-id",
				projectId: "project",
			}),
		).rejects.toMatchObject({ code: "INVALID_API_KEY" });
	});

	it("uses a conditional last-used update", async () => {
		const f = fixture();

		await f.service.recordSuccessfulUse({
			keyId: "key-id",
			projectId: "project",
		});

		expect(f.apiKey.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					id: "key-id",
					projectId: "project",
					revokedAt: null,
					OR: [
						{ lastUsedAt: null },
						{ lastUsedAt: { lte: expect.any(Date) } },
					],
				}),
			}),
		);
	});

	it("handles metadata failures without exposing raw errors", async () => {
		const f = fixture();
		const warn = jest.spyOn(Logger.prototype, "warn")
			.mockImplementation(() => undefined);

		f.apiKey.updateMany.mockRejectedValueOnce(
			new Error("DO_NOT_LOG_SECRET"),
		);

		await expect(
			f.service.recordSuccessfulUse({
				keyId: "key-id",
				projectId: "project",
			}),
		).resolves.toBeUndefined();

		expect(JSON.stringify(warn.mock.calls))
			.not.toContain("DO_NOT_LOG_SECRET");
	});
});
