import { PrismaService } from "../../src/database/prisma.service";
import { Prisma } from "../../src/generated/prisma/client";
import { PricingService } from "../../src/pricing/pricing.service";
import { parsePriceCatalogue } from "../../src/pricing/price-catalogue";

const entry = {
	provider: "fixture-a",
	model: "demo-fast",
	effectiveFrom: "2026-09-01T00:00:00Z",
	inputUsdPerMillion: "1",
	outputUsdPerMillion: "4",
	currency: "USD",
	isSynthetic: true,
	sourceUrl: null,
};

describe("Pricing service", () => {
	it("selects the latest eligible exact provider/model using tx", async () => {
		const findFirst = jest.fn().mockResolvedValue({ id: "price" });
		const tx = { modelPrice: { findFirst } };
		const service = new PricingService({} as PrismaService);
		const occurredAt = new Date("2026-10-01T12:00:00Z");

		await service.findEffectivePrice(
			tx as unknown as Prisma.TransactionClient,
			"fixture-a",
			"demo-fast",
			occurredAt,
		);

		expect(findFirst).toHaveBeenCalledWith({
			where: {
				provider: "fixture-a",
				model: "demo-fast",
				effectiveFrom: { lte: occurredAt },
			},
			orderBy: { effectiveFrom: "desc" },
		});
	});

	it("fails explicitly when no historical price exists", async () => {
		const service = new PricingService({} as PrismaService);

		await expect(service.findEffectivePrice(
			{
				modelPrice: { findFirst: jest.fn().mockResolvedValue(null) },
			} as unknown as Prisma.TransactionClient,
			"fixture-a",
			"demo-fast",
			new Date(),
		)).rejects.toMatchObject({ code: "MODEL_PRICE_NOT_FOUND" });
	});

	it("normalizes catalogue entries and preserves zero rates", () => {
		expect(parsePriceCatalogue([{
			...entry,
			provider: " FIXTURE-A ",
			inputUsdPerMillion: "0",
		}])[0]).toMatchObject({
			provider: "fixture-a",
			inputUsdPerMillion: "0.000000",
			outputUsdPerMillion: "4.000000",
			effectiveFrom: "2026-09-01T00:00:00.000Z",
		});
	});

	it.each([
		{ inputUsdPerMillion: 1 },
		{ inputUsdPerMillion: "-1" },
		{ inputUsdPerMillion: "1000000" },
		{ inputUsdPerMillion: "0.0000001" },
		{ isSynthetic: false, sourceUrl: null },
		{ currency: "EUR" },
		{ sourceUrl: "http://example.com/prices" },
	])("rejects malformed catalogue data: %j", patch => {
		expect(() => parsePriceCatalogue([{ ...entry, ...patch }])).toThrow();
	});

	it("rejects duplicate input identities and oversized catalogues", () => {
		expect(() => parsePriceCatalogue([entry, entry])).toThrow();
		expect(() => parsePriceCatalogue(Array(1001).fill(entry))).toThrow();
	});
});
