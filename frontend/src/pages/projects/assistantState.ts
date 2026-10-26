import type { AssistantFailure } from "../../api/assistant-errors";
import type { AssistantContext, AssistantUsage } from "../../types/assistant.types";

export type AssistantStatus =
  | "ready"
  | "requesting"
  | "streaming"
  | "complete"
  | "truncated"
  | "stopped"
  | "interrupted"
  | "failed";

export type AssistantState = {
  status: AssistantStatus;
  // Fixed context returned by the backend for THIS answer.
  context: AssistantContext | null;
  text: string;
  usage: AssistantUsage;
  failure: AssistantFailure | null;
};

export const initialAssistantState: AssistantState = {
  status: "ready",
  context: null,
  text: "",
  usage: null,
  failure: null,
};

export type AssistantAction =
  | { type: "submit" }
  | { type: "start"; context: AssistantContext }
  | { type: "delta"; text: string }
  | { type: "done"; finishReason: "stop" | "length"; usage: AssistantUsage }
  | { type: "stop" }
  | { type: "fail"; failure: AssistantFailure }
  | { type: "reset" };

// A request is in progress: only then may events change the state.
export function isActive(status: AssistantStatus): boolean {
  return status === "requesting" || status === "streaming";
}

// Shared by visible exchanges and the active answer's screen-reader live region.
export function assistantStatusText(state: AssistantState): string {
  switch (state.status) {
    case "requesting": return "Preparing answer…";
    case "streaming": return "Answer in progress.";
    case "complete": return "Answer complete.";
    case "truncated": return "Answer reached the output limit and may be incomplete";
    case "stopped": return state.text
      ? "Stopped — answer incomplete"
      : "Stopped before an answer was received.";
    case "interrupted":
    case "failed": return state.failure?.message ?? "";
    default: return "";
  }
}

export function assistantReducer(
  state: AssistantState,
  action: AssistantAction,
): AssistantState {
  switch (action.type) {
    case "reset":
      return initialAssistantState;

    case "submit":
      // A new active answer; DashboardAssistant retains earlier exchanges for display.
      if (isActive(state.status)) return state;
      return { ...initialAssistantState, status: "requesting" };

    // Everything below is ignored once the request is over (late events).
    case "start":
      if (state.status !== "requesting") return state;
      return { ...state, status: "streaming", context: action.context };

    case "delta":
      if (!isActive(state.status)) return state;
      return { ...state, status: "streaming", text: state.text + action.text };

    case "done":
      if (!isActive(state.status)) return state;
      return {
        ...state,
        status: action.finishReason === "length" ? "truncated" : "complete",
        usage: action.usage,
      };

    case "stop":
      if (!isActive(state.status)) return state;
      return { ...state, status: "stopped" };

    case "fail": {
      if (!isActive(state.status)) return state;
      const { failure } = action;
      return {
        ...state,
        status: failure.kind === "interrupted" ? "interrupted" : "failed",
        failure,
        // Access lost: protected content disappears.
        context: failure.clearContent ? null : state.context,
        text: failure.keepPartial && !failure.clearContent ? state.text : "",
      };
    }
  }
}
