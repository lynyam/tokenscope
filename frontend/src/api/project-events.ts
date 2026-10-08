import type { Project } from "../types/workspace.types";

type ProjectChange =
  | { organizationId: string; kind: "upsert"; project: Project }
  | { organizationId: string; kind: "archive"; projectId: string };

type Listener = (change: ProjectChange) => void;
const listeners = new Set<Listener>();

export function subscribeToProjectChanges(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyProjectsChanged(change: ProjectChange): void {
  // The list and sidebar consume the same confirmed server write.
  for (const listener of listeners) listener(change);
}
