import { Prisma } from "../generated/prisma/client";

import type {
	AnalyticsBucket,
	ModelRow,
	SeriesRow,
	SummaryRow,
} from "./analytics.types";

const totals = Prisma.sql`
  COUNT(*)::text AS "traceCount",

  COALESCE(
    SUM(t."inputTokens"::numeric),
    0
  )::text AS "inputTokens",

  COALESCE(
    SUM(t."outputTokens"::numeric),
    0
  )::text AS "outputTokens",

  COALESCE(
    SUM(t."estimatedCostUsd"),
    0
  )::text AS "estimatedCostUsd"
`;

export async function readSummary(
	tx: Prisma.TransactionClient,
	where: Prisma.Sql,
): Promise<SummaryRow> {
	const rows = await tx.$queryRaw<SummaryRow[]>(Prisma.sql`
    SELECT
      ${totals},

      (
        COALESCE(SUM(t."inputTokens"::numeric), 0)
        + COALESCE(SUM(t."outputTokens"::numeric), 0)
      )::text AS "totalTokens",

      (
        COUNT(*) FILTER (WHERE t.status = 'ERROR')
      )::text AS "errorCount",

      ROUND(
        100::numeric
          * COUNT(*) FILTER (WHERE t.status = 'ERROR')
          / NULLIF(COUNT(*), 0),
        2
      )::text AS "errorRatePct",

      ROUND(
        AVG(t."latencyMs"::numeric),
        3
      )::text AS "averageLatencyMs",

      COALESCE(
        BOOL_OR(price."isSynthetic"),
        false
      ) AS "containsSyntheticPricing"

    FROM "Trace" t

    JOIN "ModelPrice" price
      ON price.id = t."priceVersionId"

    WHERE ${where}
  `);

	if (rows.length !== 1) {
		throw new Error("Unexpected analytics summary result");
	}

	return rows[0];
}

export function readSeries(
	tx: Prisma.TransactionClient,
	where: Prisma.Sql,
	bucket: AnalyticsBucket,
) {
	// SQL structure comes from fixed application values, never request text.
	const part =
		bucket === "hour"
			? Prisma.sql`'hour'`
			: Prisma.sql`'day'`;

	return tx.$queryRaw<SeriesRow[]>(Prisma.sql`
    SELECT
      TO_CHAR(
        DATE_TRUNC(${part}, t."occurredAt"),
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) AS "bucketStart",

      ${totals}

    FROM "Trace" t
    WHERE ${where}

    GROUP BY DATE_TRUNC(${part}, t."occurredAt")
    ORDER BY DATE_TRUNC(${part}, t."occurredAt") ASC
  `);
}

export function readModels(
	tx: Prisma.TransactionClient,
	where: Prisma.Sql,
) {
	return tx.$queryRaw<ModelRow[]>(Prisma.sql`
    SELECT
      t.provider,
      t.model,
      ${totals}

    FROM "Trace" t
    WHERE ${where}

    GROUP BY t.provider, t.model

    ORDER BY
      SUM(t."estimatedCostUsd") DESC,
      t.provider COLLATE "C" ASC,
      t.model COLLATE "C" ASC
  `);
}
