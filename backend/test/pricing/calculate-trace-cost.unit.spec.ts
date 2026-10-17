import { Prisma } from "../../src/generated/prisma/client";
import { calculateTraceCost } from "../../src/pricing/calculate-trace-cost";

describe("Exact trace cost", () => {
	it.each([
		[0, 0, "1", "4", "0.000000000000"],
		[1000, 200, "1", "4", "0.001800000000"],
		[2000, 500, "1", "4", "0.004000000000"],
		[1000, 100, "2", "8", "0.002800000000"],
		[500, 100, "1.5", "6", "0.001350000000"],
		[1500, 300, "2", "8", "0.005400000000"],
		[1000, 200, "0", "0", "0.000000000000"],
		[
			1_000_000_000,
			1_000_000_000,
			"999999.999999",
			"999999.999999",
			"1999999999.998000000000",
		],
	])(
		"calculates %s/%s tokens at %s/%s",
		(inputTokens, outputTokens, inputRate, outputRate, expected) => {
			const result = calculateTraceCost({
				inputTokens,
				outputTokens,
				inputUsdPerMillion: new Prisma.Decimal(inputRate),
				outputUsdPerMillion: new Prisma.Decimal(outputRate),
			});

			expect(result.estimatedCostUsd.toFixed(12)).toBe(expected);
		},
	);
});
