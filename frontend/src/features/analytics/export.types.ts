// ⚠️ Ce type reproduit la forme de responses/analytics-golden.json.
// Dans ton repo, supprime-le et importe le vrai `AnalyticsSnapshot` de TSE-71.
export type AnalyticsSnapshot = {
  snapshotId: string;
  generatedAt: string;
  projectId: string;
  window: {
    from: string;
    to: string;
    timezone: string;
    bucket: string;
  };
  filters: {
    q: string | null;
    provider: string | null;
    model: string | null;
    workflow: string | null;
    status: string | null;
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

/** Copie figée au moment du clic. Les générateurs n'utilisent que ça. */
export type DashboardExportInput = Readonly<{
  project: Readonly<{ id: string; name: string }>;
  snapshot: AnalyticsSnapshot;
}>;
