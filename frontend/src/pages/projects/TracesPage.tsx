import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { isAbortError } from "../../api/http-client";
import { defaultTraceQuery, parseTraceSearchParams, serializeTraceQuery } from "../../api/trace-filters";
import { getModelChoices, listTraces } from "../../api/traces.api";
import { useProjectArchived } from "../../hooks/useProjectArchived";
import { useProjectRealtime } from "../../hooks/useProjectRealtime";
import { useAuthContext } from "../../context/AuthContext";
import { RefreshScheduler } from "../../lib/refresh-scheduler";
import type { TraceListQuery, TracePage, TraceSortField } from "../../types/trace.types";
import { TraceFilterForm, type ChoicesState, type QueryPatch } from "./TraceFilterForm";
import { TraceFailureNotice } from "./TraceFailureNotice";
import { TraceTable } from "./TraceTable";
import { classifyTraceFailure, type TraceFailure } from "./trace-failure";
import {
  getAuthSessionSnapshot,
  isAuthSessionCurrent,
  subscribeToAuthInvalidation,
} from "../../api/auth-session";

type View =
  | { key: string; phase: "loading" }
  | { key: string; phase: "ready" | "updating"; data: TracePage }
  | { key: string; phase: "stale"; data: TracePage; failure: TraceFailure }
  | { key: string; phase: "error"; failure: TraceFailure };

export function TracesPage() {
  const { organizationId, projectId } = useParams();
  const { user, isLoading } = useAuthContext();
  const session = getAuthSessionSnapshot();
  if (isLoading || !user || !session.token) return null;
  if (!organizationId || !projectId) return <p role="alert">Missing organization or project.</p>;
  // As on DocumentsPage, a new login must discard all state from the previous session.
  return <TraceExplorer key={`${organizationId}/${projectId}/${session.revision}/${user.id}`}
    organizationId={organizationId} projectId={projectId} />;
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

  const [view, setView] = useState<View>({ key: "", phase: "loading" });
  const [unavailable, setUnavailable] = useState<TraceFailure | null>(null);
  const [revoked, setRevoked] = useState(false);
  const schedulerRef = useRef<RefreshScheduler | null>(null);
  const cooldown = useRef<{
    until: number;
    failure: Extract<TraceFailure, { kind: "rate-limit" }>;
  } | null>(null);
  const { revision: sessionRevision, token } = getAuthSessionSnapshot();
  const hasSession = token !== null;
  const blocked = archived || revoked || unavailable !== null;

  // Resolve the default period (and any normalization) once, without adding history entries.
  useEffect(() => {
    if (canonical !== null && canonical !== search) setSearchParams(new URLSearchParams(canonical), { replace: true });
  }, [canonical, search, setSearchParams]);

  const ready = canonical !== null && canonical === search;

  // One scheduler per scope (project + applied query + session). All triggers go through it:
  // first load, notifications, reconnection, Refresh / Retry. A new scope disposes the old one.
  useEffect(() => {
    if (blocked || !hasSession) {
      setView({ key: "", phase: "loading" });
      return;
    }
    if (!ready || !query) return;
    const key = canonical!;
    let stopped = false;
    let missed = false; // a refresh was skipped (tab hidden / offline): redo it once when possible
    const session = getAuthSessionSnapshot();
    const isCurrent = () => !stopped && isAuthSessionCurrent(session);
    const canRun = () => document.visibilityState === "visible" && navigator.onLine !== false;

    const scheduler: RefreshScheduler = new RefreshScheduler({
      notBefore: () => cooldown.current?.until ?? 0,
      getCooldownMs: error => {
        const failure = classifyTraceFailure(error);
        return failure.kind === "rate-limit" ? failure.retryAfterSeconds * 1000 : undefined;
      },
      run: async signal => {
        if (!isCurrent()) return;
        if (!canRun()) { missed = true; return; }
        missed = false;
        setView(previous =>
          previous.key === key && "data" in previous
            ? { key, phase: "updating", data: previous.data }
            : { key, phase: "loading" });
        try {
          const data = await listTraces(organizationId, projectId, query, signal);
          if (!isCurrent() || signal.aborted) return;
          const lastPage = Math.max(1, data.totalPages);
          if (query.page > lastPage) {
            // Out-of-range page (for example after deletions): go to the last page, once.
            setSearchParams(serializeTraceQuery({ ...query, page: lastPage }), { replace: true });
            return;
          }
          setView({ key, phase: "ready", data });
        } catch (error) {
          if (!isCurrent() || signal.aborted || isAbortError(error)) return;
          const failure = classifyTraceFailure(error);
          if (failure.kind === "rate-limit") {
            cooldown.current = { until: Date.now() + failure.retryAfterSeconds * 1000, failure };
          }
          if (failure.kind === "project-unavailable") {
            stopped = true;
            scheduler.dispose();
            setUnavailable(failure);
            return;
          }
          // Same query: keep the confirmed rows (stale), never turn an error into "no results".
          setView(previous =>
            previous.key === key && "data" in previous
              ? { key, phase: "stale", data: previous.data, failure }
              : { key, phase: "error", failure });
          throw error; // lets the scheduler apply the cooldown and skip the queued follow-up
        }
      },
    });
    schedulerRef.current = scheduler;

    const stopAuthWatch = subscribeToAuthInvalidation(() => {
      stopped = true;
      scheduler.dispose();
      setView({ key: "", phase: "loading" });
    });
    const reconcile = () => {
      if (missed && canRun()) { missed = false; scheduler.request("immediate"); }
    };
    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("online", reconcile);

    const limited = cooldown.current;
    if (limited && Date.now() < limited.until) {
      // Editing the query does not remove the server's cooldown.
      setView({
        key,
        phase: "error",
        failure: { ...limited.failure, retryAfterSeconds: Math.ceil((limited.until - Date.now()) / 1000) },
      });
    } else {
      scheduler.request("immediate"); // first load of this scope
    }

    return () => {
      stopped = true;
      stopAuthWatch();
      scheduler.dispose();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("online", reconcile);
    };
    // `query` is derived from `canonical`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, projectId, canonical, ready, blocked, sessionRevision, hasSession]);

  // Declared after the effect above: the scheduler exists when the first acknowledgement arrives.
  useProjectRealtime(organizationId, projectId, {
    onChanged: () => schedulerRef.current?.request("coalesced"),
    // After every acknowledged subscription (also after a reconnection): changes may have been missed.
    onSynced: () => schedulerRef.current?.request("coalesced"),
    onRevoked: () => setRevoked(true),
  }, hasSession && !blocked && ready && query !== null);

  const [choices, setChoices] = useState<ChoicesState>({ phase: "loading" });
  const [choicesAttempt, setChoicesAttempt] = useState(0);
  useEffect(() => {
    if (blocked || !hasSession) {
      setChoices({ phase: "loading" });
      return;
    }

    const controller = new AbortController();
    const session = getAuthSessionSnapshot();

    setChoices({ phase: "loading" });

    getModelChoices(controller.signal)
      .then(result => {
        if (
          !controller.signal.aborted &&
          isAuthSessionCurrent(session)
        ) {
          setChoices({ phase: "ready", choices: result });
        }
      })
      .catch(error => {
        if (
          !controller.signal.aborted &&
          isAuthSessionCurrent(session) &&
          !isAbortError(error)
        ) {
          setChoices({
            phase: "error",
            failure: classifyTraceFailure(error),
          });
        }
      });

    return () => controller.abort();
  }, [choicesAttempt, blocked, sessionRevision, hasSession]);

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

  const retry = () => schedulerRef.current?.request("immediate");

  if (blocked) {
    return (
      <section className="space-y-3 p-6">
        <p role="alert">This project is not available.</p>
        {unavailable?.requestId && (
          <p className="break-all text-xs">
            Request ID: {unavailable.requestId}
          </p>
        )}
        <Link to={"/organizations/" + encodeURIComponent(organizationId) + "/projects"}>Back to projects</Link>
      </section>
    );
  }

  const current = view.key === canonical ? view : null;

  return (
    <section className="mx-auto max-w-6xl space-y-4 p-6">
      <Link to={base}>← Back to project</Link>
      <h1 className="text-2xl font-semibold">Traces</h1>
      <p className="text-sm text-muted-foreground">Read-only. Times are UTC.</p>

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
        <TraceFailureNotice failure={current.failure} onRetry={retry} />
      )}
      {query && (!current || current.phase === "loading") && <p role="status">Loading traces…</p>}
      {query && current && "data" in current && (
        <>
          {current.phase === "updating" && <p role="status">Updating…</p>}
          {current.phase === "stale" && <TraceFailureNotice failure={current.failure} onRetry={retry} />}
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
              onClick={retry}>Refresh</Button>
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
