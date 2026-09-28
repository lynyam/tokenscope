import { useEffect, useState } from "react";
import { getOrganizationProjects } from "../api/projects.api";
import { subscribeToProjectChanges } from "../api/project-events";
import type { Project } from "../types/workspace.types";

interface ProjectsState {
  organizationId: string | undefined;
  projects: Project[];
  isLoading: boolean;
  error: string | null;
}

export function useOrganizationProjects(organizationId?: string) {
  const [state, setState] = useState<ProjectsState>({
    organizationId,
    projects: [],
    isLoading: Boolean(organizationId),
    error: null,
  });

  useEffect(() => {
    if (!organizationId) return;
    const requestedOrganizationId = organizationId;

    let disposed = false;
    let requestNumber = 0;

    function reload() {
      const currentRequest = ++requestNumber;
      setState({
        organizationId,
        projects: [],
        isLoading: true,
        error: null,
      });

      getOrganizationProjects(requestedOrganizationId)
        .then((projects) => {
          // A mutation refresh may finish before an earlier read of this org.
          if (disposed || currentRequest !== requestNumber) return;
          setState({ organizationId, projects, isLoading: false, error: null });
        })
        .catch((error: unknown) => {
          // An obsolete failure must not erase the current organization's list.
          if (disposed || currentRequest !== requestNumber) return;
          setState({
            organizationId,
            projects: [],
            isLoading: false,
            error: error instanceof Error ? error.message : "Failed to load projects.",
          });
        });
    }

    const unsubscribe = subscribeToProjectChanges((changedOrganizationId) => {
      if (changedOrganizationId === organizationId) reload();
    });
    reload();

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [organizationId]);

  // Effects run after rendering. Never render A's data with B's URL in between.
  if (state.organizationId !== organizationId || !organizationId) {
    return { projects: [], isLoading: Boolean(organizationId), error: null };
  }

  return state;
}
