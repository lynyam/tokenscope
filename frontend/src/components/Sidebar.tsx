import { OrganizationSwitcher } from "./OrganizationSwitcher";
import { UserMenu } from "./UserMenu";
import { CollapsibleNavItem } from "./ProjectMenu";
import { Separator } from "../components/ui/separator";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getOrganizationProjects } from "../api/projects.api";
import type { Project } from "../types/workspace.types";

export function Sidebar() {
  const { organizationId } = useParams();
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (!organizationId) return;
    getOrganizationProjects(organizationId)
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [organizationId]);

  return (
    <aside className="flex h-full w-56 flex-col border-r p-4">
      <div className="flex items-center gap-2">
        <img src="/logo/logo.svg" alt="TokenScope logo" className="h-7 w-7" />
        <span className="text-lg font-semibold">TokenScope</span>
      </div>
      <Separator className="mt-2 mb-2" />
      <nav className="flex flex-1 flex-col gap-1">
        {organizationId && (
          <>
            <Link
              to={`/organizations/${organizationId}/members`}
              className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Members
            </Link>
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
