import { useCallback, useEffect, useRef, useState } from "react";
import { analyticsSelectionKey, getAnalytics } from "../api/analytics.api";
import { ApiError, isAbortError } from "../api/http-client";
import { RefreshScheduler } from "../lib/refresh-scheduler";
import { classifyTraceFailure } from "../pages/projects/trace-failure";
import type { AnalyticsSnapshot, AppliedSelection } from "../types/analytics.types";

export const ANALYTICS_REFRESH_INTERVAL_MS = 30_000;

export type AnalyticsFailure =
  | { kind: "validation"; message: string }
  | { kind: "rate-limit"; message: string; retryAfterSeconds: number }
  | { kind: "error"; message: string };

export type AnalyticsStatus =
  | "idle" //        no valid selection: no request is made
  | "loading" //     first load of this selection: no figures yet
  | "ready" //       confirmed snapshot of this selection
  | "updating" //    confirmed snapshot still shown while a refresh runs
  | "stale" //       confirmed snapshot still shown, but the last refresh failed
  | "error" //       the first load failed: there are NO figures (never shown as empty data)
  | "unavailable"; //the project is gone: protected content is cleared

interface Loaded {
  key: string;
  snapshot: AnalyticsSnapshot | null;
  updating: boolean;
  failure: AnalyticsFailure | null;
  unavailable: boolean;
}

const blank = (key: string): Loaded => ({
  key, snapshot: null, updating: false, failure: null, unavailable: false,
});

export interface ProjectAnalytics {
  status: AnalyticsStatus;
  /** Always belongs to the CURRENT selection, or is null. */
  snapshot: AnalyticsSnapshot | null;
  failure: AnalyticsFailure | null;
  /** Explicit Refresh / Retry: runs now (still respecting a rate-limit cooldown). */
  refresh: () => void;
  /** A realtime notification: runs soon, coalesced with others. */
  notifyChanged: () => void;
}

function classify(error: unknown): AnalyticsFailure | "project-unavailable" {
  const failure = classifyTraceFailure(error);
  switch (failure.kind) {
    case "project-unavailable":
      return "project-unavailable";
    case "validation":
      return { kind: "validation", message: failure.message };
    case "rate-limit":
      return { kind: "rate-limit", message: failure.message, retryAfterSeconds: failure.retryAfterSeconds };
    default:
      return { kind: "error", message: "Failed to load analytics." };
  }
}

/**
 * Loads the analytics of ONE applied selection and keeps them fresh.
 *
 * - A new selection aborts the previous request and clears the previous figures at once.
 * - A refresh of the same selection keeps the confirmed snapshot visible.
 * - All triggers (initial load, notifications, focus, 30 s tick, Refresh) go through one scheduler.
 * - Pass `null` when the selection is invalid: nothing is requested.
 */
export function useProjectAnalytics(selection: AppliedSelection | null): ProjectAnalytics {
  const key = selection ? analyticsSelectionKey(selection) : "";
  const [loaded, setLoaded] = useState<Loaded>(() => blank(""));
  const schedulerRef = useRef<RefreshScheduler | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    const current = selectionRef.current;
    if (!current || key === "") return;

    let stopped = false;

    const scheduler: RefreshScheduler = new RefreshScheduler({
      run: async signal => {
        setLoaded(previous =>
          previous.key === key ? { ...previous, updating: true } : { ...blank(key), updating: true });
        try {
          const snapshot = await getAnalytics(current, signal);
          if (stopped || signal.aborted) return;
          setLoaded({ key, snapshot, updating: false, failure: null, unavailable: false });
        } catch (error) {
          if (stopped || signal.aborted || isAbortError(error)) return;
          const failure = classify(error);
          if (failure === "project-unavailable") {
            // Clear protected content and stop everything for this selection.
            setLoaded({ ...blank(key), unavailable: true });
            stopped = true;
            scheduler.dispose();
          } else {
            // Same selection: keep the confirmed snapshot (stale), never turn an error into "empty".
            setLoaded(previous => ({
              ...(previous.key === key ? previous : blank(key)),
              updating: false,
              failure,
            }));
            // The session is no longer valid: stop retrying (the app handles the sign-out).
            if (error instanceof ApiError && error.statusCode === 401) {
              stopped = true;
              scheduler.dispose();
            }
          }
          throw error; // lets the scheduler apply the cooldown and skip the queued follow-up
        }
      },
    });
    schedulerRef.current = scheduler;

    const isVisible = () => document.visibilityState === "visible";
    const isOnline = () => navigator.onLine !== false;
    // Routine triggers never run while the browser is offline or the tab is hidden.
    const routine = () => { if (isVisible() && isOnline()) scheduler.request("coalesced"); };

    scheduler.request("immediate"); // initial load

    const tick = window.setInterval(routine, ANALYTICS_REFRESH_INTERVAL_MS);
    const onVisibility = () => routine();
    const onFocus = () => routine();
    // Back online: resynchronize now.
    const onOnline = () => scheduler.request("immediate");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    return () => {
      stopped = true;
      scheduler.dispose();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [key]);

  const refresh = useCallback(() => schedulerRef.current?.request("immediate"), []);
  const notifyChanged = useCallback(() => schedulerRef.current?.request("coalesced"), []);

  // Figures of another selection are never shown.
  const state = loaded.key === key ? loaded : blank(key);

  let status: AnalyticsStatus;
  if (!selection) status = "idle";
  else if (state.unavailable) status = "unavailable";
  else if (state.snapshot && state.failure) status = "stale";
  else if (state.snapshot && state.updating) status = "updating";
  else if (state.snapshot) status = "ready";
  else if (state.failure) status = "error";
  else status = "loading";

  return { status, snapshot: state.snapshot, failure: state.failure, refresh, notifyChanged };
}

/** What the assistant (TSE-81) needs to know about the dashboard selection. */
export type AssistantSelectionState = "loading" | "ready" | "empty" | "error" | "invalid";

export function toAssistantSelectionState(
  status: AnalyticsStatus,
  snapshot: AnalyticsSnapshot | null,
): AssistantSelectionState {
  if (status === "idle") return "invalid";
  if (status === "unavailable" || status === "error") return "error";
  if (status === "loading" || !snapshot) return "loading";
  return snapshot.summary.traceCount === 0 ? "empty" : "ready";
}
