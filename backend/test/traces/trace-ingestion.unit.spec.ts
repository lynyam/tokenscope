import { ApiException } from "../../src/common/errors/api.exception";
import {
	isTraceIdentityConflict,
	runSerializable,
} from "../../src/database/run-serializable";
import { PrismaService } from "../../src/database/prisma.service";
import { ApiKeyAuthService } from "../../src/api-keys/api-key-auth.service";
import { PricingService } from "../../src/pricing/pricing.service";
import { TraceChangesService } from "../../src/traces/trace-changes.service";
import { TracesService } from "../../src/traces/traces.service";
import { normalizeTracePayload, hashTracePayload } from "../../src/traces/trace-payload";
import { Prisma } from "../../src/generated/prisma/client";
import { mapTrace, type TraceResponseRow } from "../../src/traces/trace.mapper";

const payload = normalizeTracePayload({
	externalId: "unit-1",
	provider: "fixture-a",
	model: "demo-fast",
	workflow: "support",
	inputTokens: 1000,
	outputTokens: 200,
	latencyMs: 1000,
	status: "SUCCESS",
	occurredAt: "2026-10-01T10:00:00Z",
});

function storedRow(): TraceResponseRow {
	return {
		id: "trace",
		projectId: "project",
		...payload,
		occurredAt: new Date(payload.occurredAt),
		priceVersionId: "price",
		inputUsdPerMillion: new Prisma.Decimal("1"),
		outputUsdPerMillion: new Prisma.Decimal("4"),
		inputCostUsd: new Prisma.Decimal("0.001"),
		outputCostUsd: new Prisma.Decimal("0.0008"),
		estimatedCostUsd: new Prisma.Decimal("0.0018"),
		payloadHash: hashTracePayload(payload),
		version: 1,
		deletedAt: null,
		createdAt: new Date("2026-10-02T08:00:00Z"),
		updatedAt: new Date("2026-10-02T08:00:00Z"),
		priceVersion: { currency: "USD", isSynthetic: true },
	};
}

describe("Trace ingestion orchestration", () => {
	const principal = { keyId: "key", projectId: "project" };

	function setup() {
		let committed = false;
		const row = storedRow();

		const tx = {
			trace: {
				findUnique: jest.fn().mockResolvedValue(null),
				findFirst: jest.fn().mockResolvedValue(row),
				create: jest.fn().mockResolvedValue(row),
			},
		};

		const prisma = {
			$transaction: jest.fn(async (work: (client: unknown) => Promise<unknown>) => {
				const result = await work(tx);
				committed = true;
				return result;
			}),
		};

		const auth = {
			assertActivePrincipal: jest.fn().mockResolvedValue(undefined),
		};

		const pricing = {
			findEffectivePrice: jest.fn().mockResolvedValue({
				id: "price",
				inputUsdPerMillion: new Prisma.Decimal("1"),
				outputUsdPerMillion: new Prisma.Decimal("4"),
			}),
		};

		const changes = {
			publish: jest.fn(async () => {
				expect(committed).toBe(true);
			}),
		};

		const service = new TracesService(
			prisma as unknown as PrismaService,
			auth as unknown as ApiKeyAuthService,
			pricing as unknown as PricingService,
			changes as unknown as TraceChangesService,
		);

		return { row, tx, prisma, auth, pricing, changes, service };
	}

	it("uses the transaction client and publishes after commit", async () => {
		const s = setup();
		const result = await s.service.ingest(principal, payload);

		expect(result.created).toBe(true);
		expect(s.auth.assertActivePrincipal).toHaveBeenCalledWith(principal, s.tx);
		expect(s.pricing.findEffectivePrice.mock.calls[0][0]).toBe(s.tx);
		expect(s.changes.publish).toHaveBeenCalledTimes(1);
	});

	it("returns an unchanged replay without pricing or publication", async () => {
		const s = setup();
		s.tx.trace.findUnique.mockResolvedValue(s.row);

		const result = await s.service.ingest(principal, payload);

		expect(result).toEqual({ created: false, trace: mapTrace(s.row) });
		expect(s.pricing.findEffectivePrice).not.toHaveBeenCalled();
		expect(s.tx.trace.create).not.toHaveBeenCalled();
		expect(s.changes.publish).not.toHaveBeenCalled();
	});

	it.each([
		["TRACE_DELETED", { deletedAt: new Date() }],
		["TRACE_EXTERNAL_ID_CONFLICT", { payloadHash: "different" }],
	])("rejects %s without publishing", async (code, patch) => {
		const s = setup();
		s.tx.trace.findUnique.mockResolvedValue({ ...s.row, ...patch });

		await expect(s.service.ingest(principal, payload))
			.rejects.toMatchObject({ code });

		expect(s.changes.publish).not.toHaveBeenCalled();
	});

	it("does not publish for a same-value PUT", async () => {
        const s = setup();
        await s.service.replace(principal, "trace", '"1"', payload);
        expect(s.changes.publish).not.toHaveBeenCalled();
    });

    it("does not publish when commit fails after the write", async () => {
        const s = setup();
        s.prisma.$transaction.mockImplementation(async work => {
            await work(s.tx);
            throw new Error("commit failed");
        });
        await expect(s.service.ingest(principal, payload)).rejects.toThrow("commit failed");
        expect(s.changes.publish).not.toHaveBeenCalled();
    });

	it("retains success when publication fails", async () => {
		const s = setup();
		s.changes.publish.mockRejectedValueOnce(new Error("unavailable"));

		await expect(s.service.ingest(principal, payload))
			.resolves.toMatchObject({ created: true });
	});

	it("does not publish after persistence failure", async () => {
		const s = setup();
		s.tx.trace.create.mockRejectedValueOnce(new Error("database failed"));

		await expect(s.service.ingest(principal, payload)).rejects.toThrow();
		expect(s.changes.publish).not.toHaveBeenCalled();
	});

	it("reauthorizes in a fresh transaction after a recognized conflict", async () => {
		const s = setup();
		s.tx.trace.create.mockRejectedValueOnce({
			code: "P2002",
			meta: { target: ["projectId", "externalId"] },
		});
		s.tx.trace.findUnique
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(s.row);

		const result = await s.service.ingest(principal, payload);

		expect(result.created).toBe(false);
		expect(s.prisma.$transaction).toHaveBeenCalledTimes(2);
		expect(s.auth.assertActivePrincipal).toHaveBeenCalledTimes(2);
		expect(s.changes.publish).not.toHaveBeenCalled();
	});

	it("maps only public fields with fixed decimal precision", () => {
		const response = mapTrace(storedRow());

		expect(response.pricing.inputUsdPerMillion).toBe("1.000000");
		expect(response.estimatedCostUsd).toBe("0.001800000000");
		expect(response).not.toHaveProperty("payloadHash");
		expect(response).not.toHaveProperty("deletedAt");
		expect(response).not.toHaveProperty("priceVersion");
	});
});

describe("Serializable retry classification", () => {
	it("recognizes only the trace identity unique constraint", () => {
		expect(isTraceIdentityConflict({
			code: "P2002",
			meta: { target: ["projectId", "externalId"] },
		})).toBe(true);

		expect(isTraceIdentityConflict({
			code: "P2002",
			meta: { target: ["id"] },
		})).toBe(false);
	});

	it("stops after three serialization failures", async () => {
		const transaction = jest.fn().mockRejectedValue({ code: "P2034" });

		await expect(runSerializable(
			{ $transaction: transaction } as unknown as PrismaService,
			async () => undefined,
		)).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });

		expect(transaction).toHaveBeenCalledTimes(3);
	});

	it("does not retry domain errors", async () => {
		const error = new ApiException(400, "MODEL_PRICE_NOT_FOUND", "Missing.");
		const transaction = jest.fn().mockRejectedValue(error);

		await expect(runSerializable(
			{ $transaction: transaction } as unknown as PrismaService,
			async () => undefined,
		)).rejects.toBe(error);

		expect(transaction).toHaveBeenCalledTimes(1);
	});
});
