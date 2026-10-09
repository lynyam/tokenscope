/**
 * (temporary)
 * empty socket waiting for a plug
 * DI token + interface identical to TSE-71's readSnapshotInTransaction.
 * Deleted or reduced to a re-export once TSE-71 merges.
 */

/**
 * TEMPORARY CONTRACT — mirrors TSE-71's internal handoff (section 9).
 *
 * Objective: let the assistant depend on the analytics service before
 *            TSE-71 is merged, without creating a second analytics engine.
 * When TSE-71 lands:
 *  + Replace these mirrored types with imports from analytics.types.ts.
 *  + Bind ASSISTANT_ANALYTICS to the real AnalyticsService in AssistantModule.
 *  + Delete everything below that duplicates TSE-71.
 */
import type { Prisma } from '@prisma/client'; // ← use the path from prisma.service.ts

export const ASSISTANT_ANALYTICS = Symbol('ASSISTANT_ANALYTICS');

/** Who is asking and about which project. Actor comes from the verified JWT. */
export type AnalyticsScope = {
  actorId: string;
  organizationId: string;
  projectId: string;
};

/** Validated, normalized, explicit query. No pagination or sorting. */
export type ResolvedAnalyticsQuery = {
  from: Date; // inclusive
  to: Date; // exclusive: from <= occurredAt < to
  bucket: 'hour' | 'day'; // ≤ 48h → hour, otherwise day
  filters: AnalyticsFilters;
};

export type AnalyticsFilters = {
  q: string | null;
  provider: string | null;
  model: string | null;
  workflow: string | null;
  status: 'SUCCESS' | 'ERROR' | null;
};

/** Public C06 snapshot (mirrored from TSE-71 section 7). */
export type AnalyticsSnapshot = {
  snapshotId: string;
  generatedAt: string;
  projectId: string;
  window: { from: string; to: string; timezone: 'UTC'; bucket: 'hour' | 'day' };
  filters: AnalyticsFilters;
  summary: {
    traceCount: number;
    inputTokens: string;
    outputTokens: string;
    totalTokens: string;
    estimatedCostUsd: string; // exactly 12 decimals
    errorCount: number;
    errorRatePct: number | null;
    averageLatencyMs: number | null;
  };
  series: Array<{
    bucketStart: string;
    traceCount: number;
    inputTokens: string;
    outputTokens: string;
    estimatedCostUsd: string;
  }>;
  byModel: Array<{
    provider: string;
    model: string;
    traceCount: number;
    inputTokens: string;
    outputTokens: string;
    estimatedCostUsd: string;
  }>;
};

/** Internal result: snapshot + facts read in the SAME transaction. */
export type AnalyticsReadResult = {
  snapshot: AnalyticsSnapshot;
  project: { id: string; name: string; description: string | null };
  pricing: { currency: 'USD'; containsSyntheticPricing: boolean };
};

export interface AssistantAnalyticsReader {
  /**
   * Authorizes AND reads using only `tx`.
   * Does not open, commit or retry a transaction.
   * Throws PROJECT_NOT_FOUND when the actor cannot access the project.
   */
  readSnapshotInTransaction(
    tx: Prisma.TransactionClient,
    scope: AnalyticsScope,
    query: ResolvedAnalyticsQuery,
  ): Promise<AnalyticsReadResult>;
}