import { Prisma } from "../generated/prisma/client";

export const traceResponseInclude = {
	priceVersion: {
		select: {
			currency: true,
			isSynthetic: true,
		},
	},
} satisfies Prisma.TraceInclude;

export type TraceResponseRow = Prisma.TraceGetPayload<{
	include: typeof traceResponseInclude;
}>;

export function mapTrace(row: TraceResponseRow) {
	return {
		id: row.id,
		projectId: row.projectId,
		externalId: row.externalId,
		provider: row.provider,
		model: row.model,
		workflow: row.workflow,
		inputTokens: row.inputTokens,
		outputTokens: row.outputTokens,
		latencyMs: row.latencyMs,
		status: row.status,
		occurredAt: row.occurredAt.toISOString(),
		metadata: row.metadata,
		priceVersionId: row.priceVersionId,
		pricing: {
			// Read the trace's stored snapshots, not current catalogue rates.
			inputUsdPerMillion: row.inputUsdPerMillion.toFixed(6),
			outputUsdPerMillion: row.outputUsdPerMillion.toFixed(6),
			currency: row.priceVersion.currency,
			isSynthetic: row.priceVersion.isSynthetic,
		},
		inputCostUsd: row.inputCostUsd.toFixed(12),
		outputCostUsd: row.outputCostUsd.toFixed(12),
		estimatedCostUsd: row.estimatedCostUsd.toFixed(12),
		version: row.version,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export type TraceResponse = ReturnType<typeof mapTrace>;
