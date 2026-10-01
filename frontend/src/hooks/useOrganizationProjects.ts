import { useCallback, useEffect, useRef, useState } from "react";
import { getOrganizationProjects } from "../api/projects.api";
import { subscribeToProjectChanges } from "../api/project-events";
import { getApiErrorMessage, isAbortError } from "../api/http-client";
import type { Project } from "../types/workspace.types";

interface ProjectsState {
  organizationId?: string;
  projects: Project[];
  hasLoaded: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useOrganizationProjects(organizationId?: string) {
  const [state, setState] = useState<ProjectsState>({
    organizationId,
    projects: [],
    hasLoaded: false,
    isLoading: Boolean(organizationId),
    error: null,
  });

  const [attempt, setAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const reload = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!organizationId) return;

    const controller = new AbortController();
    request.current = controller;

    setState(previous => ({
      organizationId,
      projects:
        previous.organizationId === organizationId
          ? previous.projects
          : [],
      hasLoaded:
        previous.organizationId === organizationId &&
        previous.hasLoaded,
      isLoading: true,
      error: null,
    }));

    getOrganizationProjects(organizationId, controller.signal)
      .then(projects => {
        if (!controller.signal.aborted) {
          setState({
            organizationId,
            projects,
            hasLoaded: true,
            isLoading: false,
            error: null,
          });
        }
      })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return;

        // A failed refresh preserves the last confirmed list.
        setState(previous => ({
          ...previous,
          isLoading: false,
          error: getApiErrorMessage(error, "Failed to load projects."),
        }));
      });

    return () => controller.abort();
  }, [organizationId, attempt]);

  useEffect(
    () =>
      subscribeToProjectChanges(change => {
        if (change.organizationId !== organizationId) return;

        // A read started before this write must not overwrite its newer result.
        request.current?.abort();

        if (!state.hasLoaded || state.organizationId !== organizationId) {
          // One changed project cannot reconstruct an unknown full list.
          reload();
          return;
        }

        setState(previous => ({
          ...previous,
          projects:
            change.kind === "archive"
              ? previous.projects.filter(
                  project => project.id !== change.projectId,
                )
              : [
                  ...previous.projects.filter(
                    project => project.id !== change.project.id,
                  ),
                  change.project,
                ].sort(
                  (a, b) =>
                    a.createdAt.localeCompare(b.createdAt) ||
                    a.id.localeCompare(b.id),
                ),
          isLoading: false,
          error: null,
        }));
      }),
    [organizationId, state.hasLoaded, state.organizationId, reload],
  );

  // Effects run after rendering: never show A's projects under B's URL.
  if (!organizationId || state.organizationId !== organizationId) {
    return {
      projects: [],
      hasLoaded: false,
      isLoading: Boolean(organizationId),
      error: null,
      reload,
    };
  }

  return { ...state, reload };
}
