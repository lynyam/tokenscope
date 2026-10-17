import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { isAbortError } from "../../api/http-client";
import { parseTraceSearchParams } from "../../api/trace-filters";
import { formatUtcTime } from "../../api/trace-format";
import { getTrace } from "../../api/traces.api";
import { useProjectArchived } from "../../hooks/useProjectArchived";
import type { Trace } from "../../types/trace.types";
import { TraceFailureNotice } from "./TraceFailureNotice";
import { classifyTraceFailure, type TraceFailure } from "./trace-failure";

type State = { phase: "loading" } | { phase: "ready"; trace: Trace } | { phase: "error"; failure: TraceFailure };

export function TraceDetailPage() {
  const { organizationId, projectId, traceId } = useParams();
  if (!organizationId || !projectId || !traceId) return <p role="alert">Missing trace.</p>;
  return <TraceDetail key={organizationId + "/" + projectId + "/" + traceId}
    organizationId={organizationId} projectId={projectId} traceId={traceId} />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div className="grid grid-cols-3 gap-2 py-1"><dt className="text-muted-foreground">{label}</dt><dd className="col-span-2 break-all">{children}</dd></div>);
}

function TraceDetail({ organizationId, projectId, traceId }: { organizationId: string; projectId: string; traceId: string }) {
  const location = useLocation();
  const archived = useProjectArchived(organizationId, projectId);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ phase: "loading" });
  const listPath = "/organizations/" + encodeURIComponent(organizationId) + "/projects/" + encodeURIComponent(projectId) + "/traces";

  // Return to the list the person came from; a direct visit goes to the default list.
  const stored = (location.state as { listSearch?: unknown } | null)?.listSearch;
  const parsed = typeof stored === "string" && stored.startsWith("?")
    ? parseTraceSearchParams(new URLSearchParams(stored.slice(1))) : null;
  const returnTo = parsed?.ok ? listPath + "?" + parsed.canonicalSearch : listPath;

  useEffect(() => {
    if (archived) return;
    const controller = new AbortController();
    setState({ phase: "loading" });
    getTrace(organizationId, projectId, traceId, controller.signal)
      .then(trace => { if (!controller.signal.aborted) setState({ phase: "ready", trace }); })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState({ phase: "error", failure: classifyTraceFailure(error) });
      });
    return () => controller.abort();
  }, [organizationId, projectId, traceId, attempt, archived]);

  const back = <Link to={returnTo}>← Back to traces</Link>;

  if (archived || (state.phase === "error" && state.failure.kind === "project-unavailable")) {
    return <section className="space-y-3 p-6"><p role="alert">This project is not available.</p>
      <Link to={"/organizations/" + encodeURIComponent(organizationId) + "/projects"}>Back to projects</Link></section>;
  }
  if (state.phase === "loading") return <section className="p-6"><p role="status">Loading trace…</p></section>;
  if (state.phase === "error") {
    return (
      <section className="space-y-3 p-6">
        {back}
        {state.failure.kind === "trace-not-found"
          ? <p role="alert">{state.failure.message}</p>
          : <TraceFailureNotice failure={state.failure} onRetry={() => setAttempt(value => value + 1)} />}
      </section>
    );
  }

  const { trace } = state;
  return (
    <section className="mx-auto max-w-3xl space-y-4 p-6">
      {back}
      <h1 className="text-2xl font-semibold">Trace {trace.externalId}</h1>
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
