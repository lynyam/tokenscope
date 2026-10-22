export type AnalyticsSnapshot = {
  snapshotId: string;
  generatedAt: string;
  projectId: string;

  window: {
    from: string;
    to: string;
    timezone: "UTC";
    bucket: "hour" | "day";
  };

  filters: {
    q: string | null;
    provider: string | null;
    model: string | null;
    workflow: string | null;
    status: "SUCCESS" | "ERROR" | null;
  };

  summary: {
    traceCount: number;
    inputTokens: string;
    outputTokens: string;
    totalTokens: string;
    estimatedCostUsd: string;
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

/**
 * Entrée capturée au clic (contrat : docs/API.md, « Dashboard exports — TSE-77 »).
 * Les générateurs n'utilisent que ça.
 */
export type DashboardExportInput = Readonly<{
  project: Readonly<{ id: string; name: string }>;
  snapshot: AnalyticsSnapshot;
}>;