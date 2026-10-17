import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { isAbortError } from "../../api/http-client";
import { defaultTraceQuery, parseTraceSearchParams, serializeTraceQuery } from "../../api/trace-filters";
import { getModelChoices, listTraces } from "../../api/traces.api";
import { useProjectArchived } from "../../hooks/useProjectArchived";
import type { TraceListQuery, TracePage, TraceSortField } from "../../types/trace.types";
import { TraceFilterForm, type ChoicesState, type QueryPatch } from "./TraceFilterForm";
import { TraceFailureNotice } from "./TraceFailureNotice";
import { TraceTable } from "./TraceTable";
import { classifyTraceFailure, type TraceFailure } from "./trace-failure";

type View =
  | { key: string; phase: "loading" }
  | { key: string; phase: "ready" | "updating"; data: TracePage }
  | { key: string; phase: "error"; failure: TraceFailure };

export function TracesPage() {
  const { organizationId, projectId } = useParams();
  if (!organizationId || !projectId) return <p role="alert">Missing organization or project.</p>;
  return <TraceExplorer key={organizationId + "/" + projectId} organizationId={organizationId} projectId={projectId} />;
}

function TraceExplorer({ organizationId, projectId }: { organizationId: string; projectId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const base = "/organizations/" + encodeURIComponent(organizationId) + "/projects/" + encodeURIComponent(projectId);
  const archived = useProjectArchived(organizationId, projectId);
  const search = searchParams.toString();
  const parsed = useMemo(() => parseTraceSearchParams(new URLSearchParams(search)), [search]);
  const query = parsed.ok ? parsed.query : null;
  const canonical = parsed.ok ? parsed.canonicalSearch : null;

  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<View>({ key: "", phase: "loading" });
  const [unavailable, setUnavailable] = useState(false);
  const generation = useRef(0);

  // Resolve the default period (and any normalization) once, without adding history entries.
  useEffect(() => {
    if (canonical !== null && canonical !== search) setSearchParams(new URLSearchParams(canonical), { replace: true });
  }, [canonical, search, setSearchParams]);

  const ready = canonical !== null && canonical === search;

  useEffect(() => {
    if (!ready || !query || archived) return;
    const controller = new AbortController();
    const id = ++generation.current;
    const key = canonical!;
    setView(previous =>
      previous.key === key && "data" in previous
        ? { key, phase: "updating", data: previous.data }
        : { key, phase: "loading" });
    listTraces(organizationId, projectId, query, controller.signal)
      .then(data => {
        if (controller.signal.aborted || id !== generation.current) return;
        const lastPage = Math.max(1, data.totalPages);
        if (query.page > lastPage) {
          // Out-of-range page (for example after deletions): go to the last page, once.
          setSearchParams(serializeTraceQuery({ ...query, page: lastPage }), { replace: true });
          return;
        }
        setView({ key, phase: "ready", data });
      })
      .catch(error => {
        if (controller.signal.aborted || id !== generation.current || isAbortError(error)) return;
        const failure = classifyTraceFailure(error);
        if (failure.kind === "project-unavailable") { setUnavailable(true); return; }
        setView({ key, phase: "error", failure });
      });
    return () => controller.abort();
    // `query` is derived from `canonical`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, projectId, canonical, ready, attempt, archived]);

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

  const apply = useCallback((next: TraceListQuery, replace = false) => {
    setSearchParams(serializeTraceQuery(next), { replace });
  }, [setSearchParams]);

  const change = useCallback((patch: QueryPatch, options?: { replace?: boolean }) => {
    if (!query) return;
    const next = { ...query, ...patch, page: 1 } as TraceListQuery;
    for (const key of Object.keys(patch) as (keyof QueryPatch)[]) if (patch[key] === undefined) delete next[key];
    apply(next, options?.replace);
  }, [query, apply]);

  const reset = useCallback(() => apply(defaultTraceQuery()), [apply]);

  function sort(field: TraceSortField) {
    if (!query) return;
    const sortOrder = field === query.sortBy && query.sortOrder === "desc" ? "asc" : "desc";
    apply({ ...query, sortBy: field, sortOrder, page: 1 });
  }

  if (archived || unavailable) {
    return (
      <section className="space-y-3 p-6">
        <p role="alert">This project is not available.</p>
        <Link to={"/organizations/" + encodeURIComponent(organizationId) + "/projects"}>Back to projects</Link>
      </section>
    );
  }

  const current = view.key === canonical ? view : null;

  return (
    <section className="mx-auto max-w-6xl space-y-4 p-6">
      <Link to={base}>← Back to project</Link>
      <h1 className="text-2xl font-semibold">Traces</h1>
      <p className="text-sm text-muted-foreground">Read-only. Times are UTC. Realtime updates: pending integration.</p>

      {!parsed.ok && (
        <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-4 text-sm">
          <p>This link contains filters that cannot be applied:</p>
          <ul className="list-disc pl-5">{parsed.errors.map(message => <li key={message}>{message}</li>)}</ul>
          <Button variant="outline" onClick={reset}>Reset</Button>
        </div>
      )}

      {query && (
        <TraceFilterForm query={query} choices={choices} onChange={change} onReset={reset}
          onRetryChoices={() => setChoicesAttempt(value => value + 1)} />
      )}

      {query && current?.phase === "error" && (
        <TraceFailureNotice failure={current.failure} onRetry={() => setAttempt(value => value + 1)} />
      )}
      {query && (!current || current.phase === "loading") && <p role="status">Loading traces…</p>}
      {query && current && "data" in current && (
        <>
          {current.phase === "updating" && <p role="status">Updating…</p>}
          <p className="text-sm" data-testid="trace-summary">
            {current.data.total} traces · Page {current.data.page} of {Math.max(1, current.data.totalPages)}
          </p>
          {current.data.items.length === 0 ? (
            <p>No traces match this period and these filters.</p>
          ) : (
            <TraceTable items={current.data.items} query={query} detailBase={base + "/traces"}
              listSearch={location.search} onSort={sort} />
          )}
          <div className="flex gap-2">
            <Button variant="outline" disabled={current.phase === "updating"}
              onClick={() => setAttempt(value => value + 1)}>Refresh</Button>
            <Button variant="outline" disabled={query.page <= 1 || current.phase === "updating"}
              onClick={() => apply({ ...query, page: query.page - 1 })}>Previous</Button>
            <Button variant="outline"
              disabled={query.page >= current.data.totalPages || current.phase === "updating"}
              onClick={() => apply({ ...query, page: query.page + 1 })}>Next</Button>
          </div>
        </>
      )}
    </section>
  );
}
