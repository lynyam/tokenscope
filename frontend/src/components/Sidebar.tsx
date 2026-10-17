import { OrganizationSwitcher } from "./OrganizationSwitcher";
import { UserMenu } from "./UserMenu";
import { CollapsibleNavItem } from "./ProjectMenu";
import { Separator } from "../components/ui/separator";
import { Link, useParams } from "react-router-dom";
import { useOrganizationProjects } from "../hooks/useOrganizationProjects";
import { Activity, LayoutDashboard } from "lucide-react";

export function Sidebar() {
  const { organizationId, projectId } = useParams();
  const { projects, isLoading, error, reload, accessLost } =
    useOrganizationProjects(organizationId);

  const currentProject = projects.find((project) => project.id === projectId);

  return (
    <aside className="flex h-full w-56 flex-col border-r p-4">
      <div className="flex items-center gap-2">
        <img src="/logo/logo.svg" alt="TokenScope logo" className="h-7 w-7" />
        <span className="text-lg font-semibold">TokenScope</span>
      </div>
      <Separator className="mt-2 mb-2" />
      <nav className="flex flex-1 flex-col gap-1">
        {organizationId &&
          (accessLost ? (
            <div className="px-3 text-sm">
              <p role="alert">Organization not found.</p>
              <Link to="/organizations" className="underline">
                Back to organizations
              </Link>
            </div>
          ) : (
            <>
              <Link
                to={`/organizations/${organizationId}/members`}
                className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Members
              </Link>
              {isLoading && (
                <p role="status" className="px-3 text-sm">
                  Loading projects…
                </p>
              )}
              {error && (
                <div className="px-3 text-sm">
                  <p role="alert">{error}</p>
                  <button type="button" onClick={reload} className="underline">
                    Retry projects
                  </button>
                </div>
              )}
              <CollapsibleNavItem
                label="Projects"
                items={projects.map((project) => ({
                  id: project.id,
                  name: project.name,
                  to: `/organizations/${organizationId}/projects/${project.id}`,
                }))}
                organizationId={organizationId}
              />
            </>
          ))}

        {organizationId && projectId && currentProject && !accessLost && (
          <div className="mt-4 flex flex-col gap-1">
            <span className="truncate px-3 py-2 text-sm font-medium">
              {currentProject.name}
            </span>
            <Separator className="mb-1" />

            <span
              aria-disabled="true"
              className="flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground opacity-50"
            >
              <Activity className="h-4 w-4" />
              Traces
            </span>

            <span
              aria-disabled="true"
              className="flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground opacity-50"
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </span>
          </div>
        )}
      </nav>

      <div className="flex flex-col gap-3">
        <OrganizationSwitcher />
        <Separator />
        <UserMenu />
      </div>
    </aside>
  );
}
