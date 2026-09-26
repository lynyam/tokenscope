import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Plus } from "lucide-react";

type CollapsibleNavItemProps = {
  label: string;
  items: { id: string; name: string; to: string }[];
  organizationId?: string;
};

export function CollapsibleNavItem({ label, items, organizationId }: CollapsibleNavItemProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="flex flex-col">
      <button
        type="button"
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
            <Link
              key={item.id}
              to={item.to}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              {item.name}
            </Link>
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