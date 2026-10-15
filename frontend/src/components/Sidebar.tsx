import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Menu } from "lucide-react";
import { OrganizationSwitcher } from "./OrganizationSwitcher";
import { UserMenu } from "./UserMenu";
import { CollapsibleNavItem } from "./ProjectMenu";
import { Separator } from "../components/ui/separator";
import { useOrganizationProjects } from "../hooks/useOrganizationProjects";
import { ThemeToggle } from "./ThemeToggle";

export function Sidebar() {
  const { organizationId } = useParams();
  const { projects, isLoading, error, reload } =
    useOrganizationProjects(organizationId);

  // Mobile : menu ouvert ou fermé
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  // Ferme le menu à chaque changement de page
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Bouton hamburger flottant (mobile uniquement) */}
      <button
        type="button"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
        className="fixed left-3 bottom-3 z-30 rounded-md border bg-background/80 p-2 backdrop-blur md:hidden"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* Fond sombre (mobile uniquement, seulement quand le menu est ouvert) */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-full w-56 shrink-0 flex-col border-r bg-background p-4 transition-transform md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2">
          <img src="/logo/logo.svg" alt="TokenScope logo" className="h-7 w-7" />
          <span className="text-lg font-semibold">TokenScope</span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
        <Separator className="mb-2 mt-2" />

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {organizationId && (
            <>
              <Link
                to={`/organizations/${organizationId}/members`}
                className="rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
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
          )}
        </nav>

        <div className="flex flex-col gap-3">
          <OrganizationSwitcher />
          <Separator />
          <UserMenu />
        </div>
      </aside>
    </>
  );
}