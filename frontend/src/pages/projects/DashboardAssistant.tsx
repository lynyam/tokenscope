import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react";
import { isAbortError } from "../../api/http-client";
import type { ApiStreamResponse } from "../../api/http-client";
import {
  askAssistant,
  normalizeFilters,
  validateAssistantQuestion,
} from "../../api/assistant.api";
import {
  describeAssistantError,
  describeStreamErrorEvent,
} from "../../api/assistant-errors";
import type { AssistantFailure } from "../../api/assistant-errors";
import { assistantScopeKey } from "../../api/assistant-scope";
import type { AssistantSelection } from "../../types/assistant.types";
import { assistantReducer, initialAssistantState, isActive } from "./assistantState";
import { AssistantContextCard } from "./AssistantContextCard";

// What the dashboard tells us about the applied selection.
export type AssistantSelectionState = "loading" | "ready" | "empty" | "error" | "invalid";

export type DashboardAssistantProps = {
  organizationId: string;
  projectId: string;
  projectName: string;
  // The dashboard's APPLIED selection (exact UTC dates + active filters).
  selection: AssistantSelection;
  // Whether the dashboard has a confirmed result for that applied selection.
  selectionState: AssistantSelectionState;
  // Called when the backend says the project is no longer available.
  onProjectUnavailable?: () => void;
};

const NOTICE =
  "Your question, project name and description, and analytics for the selected period and filters are sent to Gemini to generate an answer. Do not include secrets.";
const TRUNCATED = "Answer reached the output limit and may be incomplete";
const STOPPED = "Stopped — answer incomplete";

const BLOCKED_REASON: Record<Exclude<AssistantSelectionState, "ready">, string> = {
  loading: "Waiting for the dashboard to load this selection…",
  error: "The dashboard could not load this selection.",
  invalid: "The selected period or filters are invalid.",
  empty: "No traces match this selection",
};

export function DashboardAssistant({
  organizationId,
  projectId,
  projectName,
  selection,
  selectionState,
  onProjectUnavailable,
}: DashboardAssistantProps) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [submittedQuestion, setSubmittedQuestion] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [state, dispatch] = useReducer(assistantReducer, initialAssistantState);
  const [cooldownEnd, setCooldownEnd] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const fieldId = useId();
  const errorId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Submission lock: a ref is readable immediately, unlike a disabled button.
  const lockRef = useRef(false);
  const requestSeq = useRef(0);
  const active = useRef<{ id: number; controller: AbortController } | null>(null);
  const onUnavailableRef = useRef(onProjectUnavailable);
  onUnavailableRef.current = onProjectUnavailable;

  const scopeKey = assistantScopeKey({
    organizationId,
    projectId,
    from: selection.from,
    to: selection.to,
    filters: selection.filters,
  });

  // Aborts the running request and forgets it. A finished-late request can
  // then no longer unlock or overwrite a newer one.
  const cancelActive = useCallback(() => {
    const current = active.current;
    active.current = null;
    lockRef.current = false;
    current?.controller.abort();
  }, []);

  // Another project, period or filters: stop and clear the previous answer.
  useEffect(() => {
    cancelActive();
    dispatch({ type: "reset" });
    setSubmittedQuestion("");
    setValidationError(null);
  }, [scopeKey, cancelActive]);

  // Leaving the page: abort and clean up.
  useEffect(() => cancelActive, [cancelActive]);

  // Focus management: textarea on open, launcher on close.
  useEffect(() => {
    if (open) textareaRef.current?.focus();
    else if (wasOpen.current) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // Countdown while the server asks us to wait (Retry-After).
  useEffect(() => {
    if (cooldownEnd === null) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= cooldownEnd) setCooldownEnd(null);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownEnd]);

  const waitLeft =
    cooldownEnd === null ? 0 : Math.max(0, Math.ceil((cooldownEnd - now) / 1000));
  const running = isActive(state.status);
  const canAsk = selectionState === "ready" && !running && waitLeft === 0;

  function startCooldown(seconds: number) {
    const current = Date.now();
    setNow(current);
    setCooldownEnd(current + seconds * 1000);
  }

  function applyFailure(failure: AssistantFailure, stream: ApiStreamResponse | null) {
    // Only the session that started this request is invalidated.
    if (failure.invalidateSession) stream?.invalidateSession();
    dispatch({ type: "fail", failure });
    if (failure.waitSeconds !== undefined) startCooldown(failure.waitSeconds);
    if (failure.notifyProjectUnavailable) onUnavailableRef.current?.();
  }

  async function ask() {
    if (lockRef.current) return; // duplicate submission
    if (!canAsk) return;

    const problem = validateAssistantQuestion(question);
    if (problem) {
      setValidationError(
        problem === "empty" ? "Enter a question." : "The question must be at most 2000 characters.",
      );
      return;
    }

    lockRef.current = true; // before the first await
    const id = ++requestSeq.current;
    const controller = new AbortController();
    active.current = { id, controller };
    const isCurrent = () => active.current?.id === id;

    setValidationError(null);
    setSubmittedQuestion(question.trim());
    dispatch({ type: "submit" });

    let stream: ApiStreamResponse | null = null;
    try {
      const answer = await askAssistant({
        organizationId,
        projectId,
        question,
        selection,
        signal: controller.signal,
      });
      stream = answer.stream;

      for await (const event of answer.events) {
        if (!isCurrent()) return;
        if (!stream.isSessionCurrent()) {
          // Signed out or signed in as someone else: drop protected content.
          cancelActive();
          dispatch({ type: "reset" });
          return;
        }
        switch (event.type) {
          case "start":
            dispatch({ type: "start", context: event.data.context });
            break;
          case "delta":
            dispatch({ type: "delta", text: event.data.text });
            break;
          case "done":
            dispatch({
              type: "done",
              finishReason: event.data.finishReason,
              usage: event.data.usage,
            });
            break;
          case "error":
            applyFailure(describeStreamErrorEvent(event.data), stream);
            break;
        }
      }
    } catch (error) {
      // Stop, close, scope change and unmount abort on purpose: not an error.
      if (controller.signal.aborted || isAbortError(error)) return;
      if (!isCurrent()) return;
      applyFailure(describeAssistantError(error), stream);
    } finally {
      // Only unlock if this request is still the current one.
      if (active.current?.id === id) {
        active.current = null;
        lockRef.current = false;
      }
    }
  }

  function stop() {
    if (!active.current) return;
    dispatch({ type: "stop" });
    cancelActive();
  }

  function close() {
    cancelActive();
    dispatch({ type: "reset" });
    setQuestion("");
    setSubmittedQuestion("");
    setValidationError(null);
    setOpen(false);
  }

  const activeFilters = Object.entries(normalizeFilters(selection.filters));

  const liveText = (() => {
    switch (state.status) {
      case "requesting":
        return "Preparing answer…";
      case "streaming":
        return "Answer in progress.";
      case "complete":
        return "Answer complete.";
      case "truncated":
        return TRUNCATED;
      case "stopped":
        return STOPPED;
      case "interrupted":
      case "failed":
        return state.failure?.message ?? "";
      default:
        return "";
    }
  })();

  if (!open) {
    return (
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 rounded-full bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-lg hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2"
      >
        Ask assistant
      </button>
    );
  }

  return (
    <section
      role="dialog"
      aria-label="Ask assistant"
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-white md:inset-auto md:bottom-4 md:right-4 md:h-[34rem] md:w-96 md:rounded-xl md:border md:border-slate-200 md:shadow-2xl"
    >
      <header className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Ask assistant</h2>
          <p className="break-words text-xs text-slate-600">{projectName}</p>
          <p className="break-words text-xs text-slate-500">
            {selection.from} → {selection.to} (UTC)
          </p>
          <p className="break-words text-xs text-slate-500">
            {activeFilters.length === 0
              ? "No filters"
              : activeFilters.map(([key, value]) => key + ": " + value).join(" · ")}
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close assistant"
          className="rounded p-1 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-4 py-3">
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">{NOTICE}</p>

        {submittedQuestion && state.status !== "ready" && (
          <div className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white">
            {submittedQuestion}
          </div>
        )}

        {state.context && <AssistantContextCard context={state.context} />}

        {state.status === "requesting" && (
          <p className="text-sm text-slate-600">Preparing answer…</p>
        )}

        {state.text && (
          <div className="whitespace-pre-wrap break-words text-sm text-slate-900">
            {state.text}
          </div>
        )}

        {state.status === "truncated" && (
          <p className="text-xs font-medium text-amber-700">{TRUNCATED}</p>
        )}
        {state.status === "stopped" && (
          <p className="text-xs font-medium text-slate-600">{STOPPED}</p>
        )}
        {(state.status === "interrupted" || state.status === "failed") && state.failure && (
          <div className="rounded-md bg-red-50 p-2 text-xs text-red-800">
            <p className="break-words">{state.failure.message}</p>
            {state.failure.requestId && (
              <p className="mt-1 break-all text-red-600">Request ID: {state.failure.requestId}</p>
            )}
          </div>
        )}
      </div>

      {/* Polite live region: statuses only, never every fragment. */}
      <p role="status" aria-live="polite" className="sr-only">
        {liveText}
      </p>

      <form
        className="space-y-2 border-t border-slate-200 px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <label htmlFor={fieldId} className="block text-sm font-medium">
          Your question
        </label>
        <textarea
          id={fieldId}
          ref={textareaRef}
          value={question}
          readOnly={running}
          rows={3}
          aria-invalid={validationError ? true : undefined}
          aria-describedby={validationError ? errorId : undefined}
          onChange={(event) => {
            setQuestion(event.target.value);
            if (validationError) setValidationError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void ask();
            }
          }}
          className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 read-only:bg-slate-50"
        />
        {validationError && (
          <p id={errorId} className="text-xs text-red-700">
            {validationError}
          </p>
        )}

        {selectionState !== "ready" && (
          <p className="text-xs text-slate-600">{BLOCKED_REASON[selectionState]}</p>
        )}
        {waitLeft > 0 && (
          <p className="text-xs text-slate-600">
            You can ask again in {waitLeft} {waitLeft === 1 ? "second" : "seconds"}.
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!canAsk}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Ask
          </button>
          {running && (
            <button
              type="button"
              onClick={stop}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              Stop
            </button>
          )}
        </div>
      </form>
    </section>
  );
}