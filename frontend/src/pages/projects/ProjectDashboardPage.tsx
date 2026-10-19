import { Link, useParams } from "react-router-dom";
import { useProjectArchived } from "../../hooks/useProjectArchived";
import { ProjectDashboard } from "./ProjectDashboard";

export function ProjectDashboardPage() {
  const { organizationId, projectId } = useParams();
  if (!organizationId || !projectId) return <p role="alert">Missing organization or project.</p>;
  // The key restarts everything (selection, requests, realtime) when the project changes.
  return <DashboardRoute key={organizationId + "/" + projectId} organizationId={organizationId} projectId={projectId} />;
}

function DashboardRoute({ organizationId, projectId }: { organizationId: string; projectId: string }) {
  const base = "/organizations/" + encodeURIComponent(organizationId);
  const archived = useProjectArchived(organizationId, projectId);

  if (archived) {
    return (
      <section className="space-y-3 p-6">
        <p role="alert">This project is not available.</p>
        <Link to={base + "/projects"}>Back to projects</Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-6xl space-y-4 p-6">
      <Link to={base + "/projects/" + encodeURIComponent(projectId)}>← Back to project</Link>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-sm text-muted-foreground">Read-only. Times are UTC. Costs are estimates.</p>
      <ProjectDashboard organizationId={organizationId} projectId={projectId} />
    </section>
  );
}
