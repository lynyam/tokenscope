type ProjectChangeListener = (organizationId: string) => void;

const listeners = new Set<ProjectChangeListener>();

export function subscribeToProjectChanges(listener: ProjectChangeListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyProjectsChanged(organizationId: string): void {
  // Notify only after a successful write. Each subscriber reloads its own org.
  // Keep this notification when TSE-43 replaces the mock writes with HTTP.
  for (const listener of listeners) {
    listener(organizationId);
  }
}
