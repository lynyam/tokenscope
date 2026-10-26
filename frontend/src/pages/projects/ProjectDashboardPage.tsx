import { Navigate, useLocation, useParams } from "react-router-dom";

/** Keep existing dashboard links working; Overview owns the actual dashboard. */
export function ProjectDashboardPage() {
  const { organizationId, projectId } = useParams();
  const { search } = useLocation();
  if (!organizationId || !projectId) return <p role="alert">Missing organization or project.</p>;
  return <Navigate replace to={
    "/organizations/" + encodeURIComponent(organizationId) +
    "/projects/" + encodeURIComponent(projectId) + search
  } />;
}
