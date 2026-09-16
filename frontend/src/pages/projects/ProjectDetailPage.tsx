import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getOrganizationProject } from "../../api/projects.api";
import type { Project } from "../../types/workspace.types";

export function ProjectDetailPage() {
  const { organizationId, projectId } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId || !projectId) {
      return;
    }
    let isStale = false;
    setProject(null);
    setError(null);
    setIsLoading(true);
    getOrganizationProject(organizationId, projectId)
      .then((data) => {
        if (isStale) {
          return;
        }
        setProject(data);
        setIsLoading(false);
      })
      .catch((err) => {
        if (isStale) {
          return;
        }
        setError(
          err instanceof Error ? err.message : "Failed to load project.",
        );
        setIsLoading(false);
      });
    return () => {
      isStale = true;
    };
  }, [organizationId, projectId]);
  if (!organizationId) {
    return <p>Missing organization.</p>;
  }
  if (!projectId) {
    return <p>Missing project.</p>;
  }
  if (isLoading) {
    return <p>Loading...</p>;
  }
  if (error) {
    return <p>{error}</p>;
  }
  if (!project) {
    return <p>Project not found.</p>;
  }
  return (
    <div className="p-6 space-y-6 max-w-md mx-auto">
      <div>
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <p className="text-sm text-muted-foreground">{project.slug}</p>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-2 text-sm">
        <p>
          <span className="font-medium">Description:</span>{" "}
          {project.description ?? "No description yet."}
        </p>
        <p>
          <span className="font-medium">Status:</span>{" "}
          {project.archivedAt ? "Archived" : "Active"}
        </p>
        <p>
          <span className="font-medium">Created at:</span> {project.createdAt}
        </p>
        <p>
          <span className="font-medium">Updated at:</span> {project.updatedAt}
        </p>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-1">
        <h2 className="text-lg font-semibold">Coming soon</h2>
        <p className="text-sm text-muted-foreground">API keys coming in M2.</p>
        <p className="text-sm text-muted-foreground">Traces coming in M2.</p>
        <p className="text-sm text-muted-foreground">
          Cost dashboard coming later.
        </p>
      </div>
    </div>
  );
}
