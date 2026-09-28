import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ChevronRight, Plus } from "lucide-react";

type CollapsibleNavItemProps = {
  label: string;
  items: { id: string; name: string; to: string }[];
  organizationId?: string;
};

export function CollapsibleNavItem({ label, items, organizationId }: CollapsibleNavItemProps) {
  const { pathname } = useLocation();
  const hasActiveProject = items.some((item) => item.to === pathname);
  const [isOpen, setIsOpen] = useState(hasActiveProject);

  useEffect(() => {
    if (hasActiveProject) setIsOpen(true);
  }, [pathname, hasActiveProject]);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
      >
        {label}
        <ChevronRight
          className={`h-4 w-4 text-muted-foreground transition-transform ${
            isOpen ? "rotate-90" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="flex flex-col gap-1 border-l ml-3 pl-3 mt-1">
          {items.map((item) => (
            <NavLink
              end
              key={item.id}
              to={item.to}
              className={({ isActive }) => `rounded-md px-3 py-1.5 text-sm transition-colors ${isActive ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {item.name}
            </NavLink>
          ))}

          <Link
            to={`/organizations/${organizationId}/projects`}
            className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create project
          </Link>
        </div>
      )}
    </div>
  );
}
