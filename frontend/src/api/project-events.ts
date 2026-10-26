import type { Project } from "../types/workspace.types";

type ProjectChange =
  | { organizationId: string; kind: "upsert"; project: Project }
  | { organizationId: string; kind: "archive"; projectId: string }
  | { organizationId: string; kind: "unavailable"; projectId: string };

type Listener = (change: ProjectChange) => void;
const listeners = new Set<Listener>();

export function subscribeToProjectChanges(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyProjectsChanged(change: ProjectChange): void {
  // The list and sidebar consume confirmed writes or a confirmed access loss.
  for (const listener of listeners) listener(change);
}
