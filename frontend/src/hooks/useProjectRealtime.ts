import { useEffect, useRef, useState } from "react";
import { getAuthSessionSnapshot } from "../api/auth-session";
import { subscribeToProjectRealtime, type RealtimeState } from "../api/realtime-client";

export interface ProjectRealtimeHandlers {
  /** A notification for this project arrived: refetch soon. */
  onChanged: () => void;
  /** The subscription was acknowledged (also after every reconnection): refetch now. */
  onSynced: () => void;
  /** Access to this project was revoked. */
  onRevoked: () => void;
}

/**
 * Connection state of the realtime channel of one project, plus the events as callbacks.
 * `enabled: false` (for example when the project is unavailable) closes the subscription.
 * Everything is cleaned up when the project changes or the component unmounts.
 */
export function useProjectRealtime(
  organizationId: string,
  projectId: string,
  handlers: ProjectRealtimeHandlers,
  enabled = true,
): RealtimeState {
  const sessionRevision = getAuthSessionSnapshot().revision;
  const [state, setState] = useState<RealtimeState>("connecting");
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) { setState("unavailable"); return; }
    setState("connecting");
    return subscribeToProjectRealtime(organizationId, projectId, {
      onState: setState,
      onChanged: () => handlersRef.current.onChanged(),
      onSynced: () => handlersRef.current.onSynced(),
      onRevoked: () => handlersRef.current.onRevoked(),
    });
  }, [organizationId, projectId, enabled, sessionRevision]);

  return state;
}
