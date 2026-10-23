import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { isAbortError } from "../../api/http-client";
import { parseTraceSearchParams } from "../../api/trace-filters";
import { formatUtcTime } from "../../api/trace-format";
import { getTrace } from "../../api/traces.api";
import { useProjectArchived } from "../../hooks/useProjectArchived";
import { useProjectRealtime } from "../../hooks/useProjectRealtime";
import { useAuthContext } from "../../context/AuthContext";
import { RefreshScheduler } from "../../lib/refresh-scheduler";
import type { Trace } from "../../types/trace.types";
import { TraceFailureNotice } from "./TraceFailureNotice";
import { classifyTraceFailure, type TraceFailure } from "./trace-failure";
import {
  getAuthSessionSnapshot,
  isAuthSessionCurrent,
  subscribeToAuthInvalidation,
} from "../../api/auth-session";

type State =
  | { phase: "loading" }
  | { phase: "ready" | "updating"; trace: Trace }
  | { phase: "stale"; trace: Trace; failure: TraceFailure }
  | { phase: "error"; failure: TraceFailure };

export function TraceDetailPage() {
  const { organizationId, projectId, traceId } = useParams();
  const { user, isLoading } = useAuthContext();
  const session = getAuthSessionSnapshot();
  if (isLoading || !user || !session.token) return null;
  if (!organizationId || !projectId || !traceId) return <p role="alert">Missing trace.</p>;
  // A confirmed trace and its access-loss state belong to one authenticated session.
  return <TraceDetail key={`${organizationId}/${projectId}/${traceId}/${session.revision}/${user.id}`}
    organizationId={organizationId} projectId={projectId} traceId={traceId} />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div className="grid grid-cols-3 gap-2 py-1"><dt className="text-muted-foreground">{label}</dt><dd className="col-span-2 break-all">{children}</dd></div>);
}

function TraceDetail({ organizationId, projectId, traceId }: { organizationId: string; projectId: string; traceId: string }) {
  const location = useLocation();
  const archived = useProjectArchived(organizationId, projectId);
  const [revoked, setRevoked] = useState(false);
  const [state, setState] = useState<State>({ phase: "loading" });
  const schedulerRef = useRef<RefreshScheduler | null>(null);
  const cooldownUntil = useRef(0);
  const { revision: sessionRevision, token } = getAuthSessionSnapshot();
  const hasSession = token !== null;
  const listPath = "/organizations/" + encodeURIComponent(organizationId) + "/projects/" + encodeURIComponent(projectId) + "/traces";

  // Return to the list the person came from; a direct visit goes to the default list.
  const stored = (location.state as { listSearch?: unknown } | null)?.listSearch;
  const parsed = typeof stored === "string" && stored.startsWith("?")
    ? parseTraceSearchParams(new URLSearchParams(stored.slice(1))) : null;
  const returnTo = parsed?.ok ? listPath + "?" + parsed.canonicalSearch : listPath;

  const projectGone = archived || revoked
    || (state.phase === "error" && state.failure.kind === "project-unavailable");
  const traceGone = state.phase === "error" && state.failure.kind === "trace-not-found";

  // All triggers (first load, notification, reconnection, Retry) go through one scheduler.
  useEffect(() => {
    if (archived || revoked || !hasSession) {
      setState({ phase: "loading" });
      return;
    }
    let stopped = false;
    let missed = false; // a refresh was skipped (tab hidden / offline): redo it once when possible
    const session = getAuthSessionSnapshot();
    const isCurrent = () => !stopped && isAuthSessionCurrent(session);
    const canRun = () => document.visibilityState === "visible" && navigator.onLine !== false;

    const scheduler: RefreshScheduler = new RefreshScheduler({
      notBefore: () => cooldownUntil.current,
      getCooldownMs: error => {
        const failure = classifyTraceFailure(error);
        return failure.kind === "rate-limit" ? failure.retryAfterSeconds * 1000 : undefined;
      },
      run: async signal => {
        if (!isCurrent()) return;
        if (!canRun()) { missed = true; return; }
        missed = false;
        setState(previous =>
          "trace" in previous ? { phase: "updating", trace: previous.trace } : { phase: "loading" });
        try {
          const trace = await getTrace(organizationId, projectId, traceId, signal);
          if (!isCurrent() || signal.aborted) return;
          setState({ phase: "ready", trace });
        } catch (error) {
          if (!isCurrent() || signal.aborted || isAbortError(error)) return;
          const failure = classifyTraceFailure(error);
          if (failure.kind === "rate-limit") cooldownUntil.current = Date.now() + failure.retryAfterSeconds * 1000;
          const lost = failure.kind === "trace-not-found" || failure.kind === "project-unavailable";
          if (lost) { stopped = true; scheduler.dispose(); }
          // Same trace, transient failure: keep the confirmed trace (stale), never show it as missing.
          setState(previous =>
            !lost && "trace" in previous
              ? { phase: "stale", trace: previous.trace, failure }
              : { phase: "error", failure });
          throw error; // lets the scheduler apply the cooldown and skip the queued follow-up
        }
      },
    });
    schedulerRef.current = scheduler;

    const stopAuthWatch = subscribeToAuthInvalidation(() => {
      stopped = true;
      scheduler.dispose();
      setState({ phase: "loading" });
    });
    const reconcile = () => {
      if (missed && canRun()) { missed = false; scheduler.request("immediate"); }
    };
    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("online", reconcile);

    scheduler.request("immediate"); // first load

    return () => {
      stopped = true;
      stopAuthWatch();
      scheduler.dispose();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("online", reconcile);
    };
  }, [organizationId, projectId, traceId, archived, revoked, sessionRevision, hasSession]);

  // Declared after the effect above: the scheduler exists when the first acknowledgement arrives.
  useProjectRealtime(organizationId, projectId, {
    onChanged: () => schedulerRef.current?.request("coalesced"),
    // After every acknowledged subscription (also after a reconnection): changes may have been missed.
    onSynced: () => schedulerRef.current?.request("coalesced"),
    onRevoked: () => setRevoked(true),
  }, hasSession && !projectGone && !traceGone);

  const retry = () => schedulerRef.current?.request("immediate");
  const back = <Link to={returnTo}>← Back to traces</Link>;

  if (projectGone) {
    return <section className="space-y-3 p-6"><p role="alert">This project is not available.</p>
      {state.phase === "error" && state.failure.requestId && (
        <p className="break-all text-xs">
          Request ID: {state.failure.requestId}
        </p>
      )}
      <Link to={"/organizations/" + encodeURIComponent(organizationId) + "/projects"}>Back to projects</Link></section>;
  }
  if (state.phase === "loading") return <section className="p-6"><p role="status">Loading trace…</p></section>;
  if (state.phase === "error") {
    return (
      <section className="space-y-3 p-6">
        {back}
        {state.failure.kind === "trace-not-found"
          ? <div role="alert">
            <p>{state.failure.message}</p>
            {state.failure.requestId && (
              <p className="break-all text-xs">
                Request ID: {state.failure.requestId}
              </p>
            )}
          </div>
          : <TraceFailureNotice failure={state.failure} onRetry={retry} />}
      </section>
    );
  }

  const { trace } = state;
  return (
    <section className="mx-auto max-w-3xl space-y-4 p-6">
      {back}
      <h1 className="text-2xl font-semibold">Trace {trace.externalId}</h1>
      {state.phase === "updating" && <p role="status">Updating…</p>}
      {state.phase === "stale" && <TraceFailureNotice failure={state.failure} onRetry={retry} />}
      <dl className="rounded-lg border p-4 text-sm">
        <Field label="Trace ID">{trace.id}</Field>
        <Field label="Project ID">{trace.projectId}</Field>
        <Field label="External ID">{trace.externalId}</Field>
        <Field label="Occurred at">{formatUtcTime(trace.occurredAt)} ({trace.occurredAt})</Field>
        <Field label="Provider">{trace.provider}</Field>
        <Field label="Model">{trace.model}</Field>
        <Field label="Workflow">{trace.workflow}</Field>
        <Field label="Status"><Badge variant={trace.status === "ERROR" ? "destructive" : "secondary"}>{trace.status}</Badge></Field>
        <Field label="Input tokens">{trace.inputTokens}</Field>
        <Field label="Output tokens">{trace.outputTokens}</Field>
        <Field label="Latency">{trace.latencyMs} ms</Field>
        <Field label="Input rate">${trace.pricing.inputUsdPerMillion} per million tokens</Field>
        <Field label="Output rate">${trace.pricing.outputUsdPerMillion} per million tokens</Field>
        <Field label="Currency">{trace.pricing.currency}</Field>
        <Field label="Price version">{trace.priceVersionId}</Field>
        {trace.pricing.isSynthetic && <Field label="Pricing">Synthetic pricing (demonstration rates, not a real price list)</Field>}
        <Field label="Input cost">${trace.inputCostUsd}</Field>
        <Field label="Output cost">${trace.outputCostUsd}</Field>
        <Field label="Estimated cost">${trace.estimatedCostUsd}</Field>
        <Field label="Version">{trace.version}</Field>
        <Field label="Created at">{trace.createdAt}</Field>
        <Field label="Updated at">{trace.updatedAt}</Field>
      </dl>
      <div className="space-y-1">
        <h2 className="font-semibold">Metadata</h2>
        <pre className="overflow-x-auto rounded-lg border p-3 text-xs" data-testid="trace-metadata">
          {JSON.stringify(trace.metadata, null, 2)}
        </pre>
      </div>
    </section>
  );
}
