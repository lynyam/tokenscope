import { Link, useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { getOrganizationProject } from "../../api/projects.api";
import { ApiError, getApiErrorMessage, isAbortError } from "../../api/http-client";
import type { Project } from "../../types/workspace.types";
import { Button } from "@/components/ui/button";
import { getAuthSessionSnapshot } from "../../api/auth-session";
import { ProjectDashboard } from "./ProjectDashboard";
import { DashboardAssistant } from "./DashboardAssistant";

export function ProjectDetailPage() {
  const { organizationId, projectId } = useParams();
  if (!organizationId || !projectId) return <p role="alert">Missing organization or project.</p>;
  return <ProjectDetail key={organizationId + "/" + projectId + "/" + getAuthSessionSnapshot().revision}
    organizationId={organizationId} projectId={projectId} />;
}

function ProjectDetail({ organizationId, projectId }: { organizationId: string; projectId: string }) {
  const listPath = "/organizations/" + encodeURIComponent(organizationId) + "/projects";
  const requests = useRef<AbortController | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    requests.current = controller;
    setProject(null);
    setLoadError(null);
    setIsLoading(true);
    getOrganizationProject(organizationId, projectId, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setProject(result);
      })
      .catch(failure => {
        if (controller.signal.aborted || isAbortError(failure)) return;
        // 404 or invalid id: show the "Project not found" screen instead of Retry.
        // Do not reveal whether an inaccessible project exists.
        if (
          failure instanceof ApiError &&
          (
            failure.statusCode === 404 ||
            (failure.statusCode === 400 && failure.code === "VALIDATION_ERROR")
          )
        ) {
          return;
        }
        setLoadError(getApiErrorMessage(failure, "Failed to load project."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [organizationId, projectId, attempt]);

  // The project (or its organization) is gone: clear the detail instead of
  // leaving stale data on screen.
  function clearProject() {
    requests.current?.abort();
    setProject(null);
  }

  if (isLoading) return <p role="status">Loading project…</p>;
  if (loadError) return (
    <section>
      <p role="alert">{loadError}</p>
      <Button onClick={() => setAttempt(value => value + 1)}>Retry</Button>
      <Link to={listPath}>Back to projects</Link>
    </section>
  );
  if (!project) return (
    <section>
      <p role="alert">Project not found.</p>
      <Link to={listPath}>Back to projects</Link>
    </section>
  );

  return (
    <section className="mx-auto max-w-6xl space-y-6 p-6">
      <Link to={listPath}>← Back to projects</Link>
      <h1 className="text-2xl font-semibold">{project.name}</h1>
      <p className="text-sm text-muted-foreground">{project.slug}</p>
      <ProjectDashboard
        organizationId={organizationId}
        projectId={projectId}
        project={{ id: project.id, name: project.name }}
        onUnavailable={clearProject}
        renderExtras={({ selection, selectionState }) => (
          <DashboardAssistant
            organizationId={organizationId}
            projectId={projectId}
            projectName={project.name}
            selection={{ from: selection.from, to: selection.to, filters: selection.filters }}
            selectionState={selectionState}
            onProjectUnavailable={clearProject}
          />
        )}
      />
    </section>
  );
}