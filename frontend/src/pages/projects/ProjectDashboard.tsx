import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { isAbortError } from "../../api/http-client";
import { getModelChoices } from "../../api/traces.api";
import {
  toAssistantSelectionState,
  useProjectAnalytics,
  type AnalyticsStatus,
  type AssistantSelectionState,
} from "../../hooks/useProjectAnalytics";
import { useProjectRealtime } from "../../hooks/useProjectRealtime";
import type { RealtimeState } from "../../api/realtime-client";
import type { AnalyticsSnapshot, AppliedSelection } from "../../types/analytics.types";
import { DashboardCharts } from "./DashboardCharts";
import { DashboardControls } from "./DashboardControls";
import { DashboardSummaryCards } from "./DashboardSummaryCards";
import { resolveCustomPeriod, resolvePreset, type DashboardPeriod, type PeriodPreset } from "./dashboardPeriod";
import { buildAppliedSelection, EMPTY_FILTER_DRAFT, type FilterDraft } from "./dashboardSelection";
import type { ChoicesState } from "./TraceFilterForm";
import { TraceFailureNotice } from "./TraceFailureNotice";

/**
 * What the rest of the page (assistant TSE-81, export TSE-77) may rely on.
 * `selection` is the one applied selection; `snapshot` always belongs to it (or is null).
 */
export interface DashboardHandoff {
  selection: AppliedSelection;
  snapshot: AnalyticsSnapshot | null;
  status: AnalyticsStatus;
  selectionState: AssistantSelectionState;
  /** True only when the displayed snapshot belongs to the current selection and access is valid. */
  exportEnabled: boolean;
}

interface Props {
  organizationId: string;
  projectId: string;
  /** Rendered under the figures, for example the assistant. Never rendered once access is lost. */
  renderExtras?: (handoff: DashboardHandoff) => ReactNode;
  /** The project is no longer available: the page must clear its protected content. */
  onUnavailable?: () => void;
}

const REALTIME_LABELS: Record<RealtimeState, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  offline: "Offline",
  unavailable: "Live updates unavailable",
};

const DEFAULT_PRESET: PeriodPreset = "7d";

type PeriodState = { period: DashboardPeriod; preset: PeriodPreset | "custom" };

function initialSelection(organizationId: string, projectId: string) {
  const period = resolvePreset(DEFAULT_PRESET);
  const result = buildAppliedSelection(organizationId, projectId, period, EMPTY_FILTER_DRAFT);
  if (!result.ok) throw new Error("The default selection must be valid.");
  return { period, selection: result.selection };
}

export function ProjectDashboard({ organizationId, projectId, renderExtras, onUnavailable }: Props) {
  // Lazy: the default period is resolved ONCE, to explicit dates.
  const [initial] = useState(() => initialSelection(organizationId, projectId));
  const [periodState, setPeriodState] = useState<PeriodState>({ period: initial.period, preset: DEFAULT_PRESET });
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_FILTER_DRAFT);
  const [applied, setApplied] = useState<AppliedSelection>(initial.selection);
  const [errors, setErrors] = useState<string[]>([]);
  const [revoked, setRevoked] = useState(false);

  /** Applies a new selection only when it is valid; otherwise explains why and requests nothing. */
  const commit = useCallback((period: PeriodState, nextDraft: FilterDraft) => {
    const result = buildAppliedSelection(organizationId, projectId, period.period, nextDraft);
    setDraft(nextDraft);
    if (!result.ok) { setErrors(result.errors); return; }
    setErrors([]);
    setPeriodState(period);
    setApplied(result.selection);
  }, [organizationId, projectId]);

  const analytics = useProjectAnalytics(revoked ? null : applied);
  const unavailable = revoked || analytics.status === "unavailable";

  const realtime = useProjectRealtime(organizationId, projectId, {
    onChanged: analytics.notifyChanged,
    // After every acknowledged subscription: there is no event replay, so read again.
    onSynced: analytics.notifyChanged,
    onRevoked: () => setRevoked(true),
  }, !unavailable);

  useEffect(() => { if (unavailable) onUnavailable?.(); }, [unavailable, onUnavailable]);

  const [choices, setChoices] = useState<ChoicesState>({ phase: "loading" });
  const [choicesAttempt, setChoicesAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setChoices({ phase: "loading" });
    getModelChoices(controller.signal)
      .then(result => { if (!controller.signal.aborted) setChoices({ phase: "ready", choices: result }); })
      .catch(error => { if (!controller.signal.aborted && !isAbortError(error)) setChoices({ phase: "error" }); });
    return () => controller.abort();
  }, [choicesAttempt]);

  if (unavailable) {
    return (
      <section aria-label="Analytics" className="space-y-3 rounded-lg border p-4">
        <p role="alert">This project is not available.</p>
        <Link className="underline" to={"/organizations/" + encodeURIComponent(organizationId) + "/projects"}>
          Back to projects
        </Link>
      </section>
    );
  }

  const { status, snapshot, failure } = analytics;
  const handoff: DashboardHandoff = {
    selection: applied,
    snapshot,
    status,
    selectionState: toAssistantSelectionState(status, snapshot),
    exportEnabled: snapshot !== null,
  };

  return (
    <section aria-label="Analytics" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Analytics</h2>
        <p role="status" aria-live="polite" className="text-xs uppercase tracking-wide text-muted-foreground"
          data-testid="realtime-state">
          {REALTIME_LABELS[realtime]}
        </p>
      </div>

      <DashboardControls
        period={periodState.period}
        preset={periodState.preset}
        filters={draft}
        choices={choices}
        errors={errors}
        refreshing={status === "updating" || status === "loading"}
        onPreset={preset => commit({ period: resolvePreset(preset), preset }, draft)}
        onApplyCustom={(from, to) => {
          const custom = resolveCustomPeriod(from, to);
          if (!custom.ok) return custom.message;
          commit({ period: custom.period, preset: "custom" }, draft);
          return null;
        }}
        onFilterChange={patch => commit(periodState, { ...draft, ...patch })}
        onReset={() => {
          const preset = DEFAULT_PRESET;
          commit({ period: resolvePreset(preset), preset }, EMPTY_FILTER_DRAFT);
        }}
        onRefresh={analytics.refresh}
        onRetryChoices={() => setChoicesAttempt(value => value + 1)}
      />

      {status === "loading" && <p role="status">Loading analytics…</p>}
      {status === "updating" && <p role="status">Updating…</p>}
      {status === "error" && failure && <TraceFailureNotice failure={failure} onRetry={analytics.refresh} />}
      {status === "stale" && failure && (
        <div className="space-y-2">
          <p role="status" className="text-sm text-muted-foreground">
            These figures are the last confirmed ones. They may be out of date.
          </p>
          <TraceFailureNotice failure={failure} onRetry={analytics.refresh} />
        </div>
      )}

      {snapshot && (
        <>
          <DashboardSummaryCards snapshot={snapshot} />
          {snapshot.summary.traceCount === 0
            ? <p>No traces match this period and these filters.</p>
            : <DashboardCharts snapshot={snapshot} />}
        </>
      )}

      {renderExtras?.(handoff)}
    </section>
  );
}
