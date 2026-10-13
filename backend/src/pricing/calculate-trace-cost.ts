import { Prisma } from "../generated/prisma/client";

// Local Decimal constructor: do not mutate Prisma.Decimal's global config.
const ExactDecimal = Prisma.Decimal.clone({ precision: 40 });

export function calculateTraceCost(input: {
	inputTokens: number;
	outputTokens: number;
	inputUsdPerMillion: Prisma.Decimal;
	outputUsdPerMillion: Prisma.Decimal;
}) {
	const inputCost = new ExactDecimal(input.inputUsdPerMillion.toString())
		.mul(input.inputTokens)
		.div(1_000_000);

	const outputCost = new ExactDecimal(input.outputUsdPerMillion.toString())
		.mul(input.outputTokens)
		.div(1_000_000);

	const total = inputCost.plus(outputCost);

	return {
		inputCostUsd: new Prisma.Decimal(inputCost.toFixed(12)),
		outputCostUsd: new Prisma.Decimal(outputCost.toFixed(12)),
		estimatedCostUsd: new Prisma.Decimal(total.toFixed(12)),
	};
}
