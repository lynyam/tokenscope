import type { AnalyticsSnapshot } from "../../types/analytics.types";
import { formatCostUsd, formatCount, formatErrorRate, formatLatency, NO_OBSERVATIONS } from "./dashboardFormat";

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border p-4" data-testid="metric">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      {/* Text only: values are never injected as HTML. */}
      <dd className="mt-1 text-xl font-semibold break-words">{value}</dd>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/**
 * The seven headline figures of ONE confirmed snapshot. A missing average or rate reads
 * "No observations": it is never shown as 0.
 */
export function DashboardSummaryCards({ snapshot }: { snapshot: AnalyticsSnapshot }) {
  const { summary } = snapshot;
  return (
    <section aria-label="Summary">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="Estimated cost" value={formatCostUsd(summary.estimatedCostUsd)} note="USD, estimated" />
        <Metric label="Traces" value={formatCount(String(summary.traceCount))} />
        <Metric label="Input tokens" value={formatCount(summary.inputTokens)} />
        <Metric label="Output tokens" value={formatCount(summary.outputTokens)} />
        <Metric label="Average latency" value={formatLatency(summary.averageLatencyMs)} />
        <Metric
          label="Error rate"
          value={formatErrorRate(summary.errorRatePct)}
          note={summary.errorRatePct === null ? undefined : formatCount(String(summary.errorCount)) + " failed"}
        />
      </dl>
      <p className="mt-2 text-xs text-muted-foreground" data-testid="generated-at">
        Generated at {snapshot.generatedAt.slice(0, 19).replace("T", " ")} UTC
        {summary.traceCount === 0 ? " · " + NO_OBSERVATIONS + " in this selection" : ""}
      </p>
    </section>
  );
}
