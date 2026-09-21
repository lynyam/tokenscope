import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getOrganizations } from "../api/organizations.api";
import type { OrganizationSummary } from "../types/workspace.types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Building2, ChevronsUpDown, Plus } from "lucide-react";

export function OrganizationSwitcher() {
  const { organizationId } = useParams();
  const navigate = useNavigate();
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);

  useEffect(() => {
    getOrganizations()
      .then(setOrganizations)
      .catch(() => setOrganizations([]));
  }, []);

  const currentOrganization = organizations.find((org) => org.id === organizationId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-lg border p-2 text-left hover:bg-muted transition-colors">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
          <Building2 className="h-4 w-4 text-muted-foreground" />
        </div>
        <span className="flex-1 truncate text-sm font-medium">
          {currentOrganization?.name ?? "Select organization"}
        </span>
        <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-56 rounded-lg">
        <DropdownMenuGroup>
          {organizations.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onClick={() => navigate(`/organizations/${org.id}`)}
            >
              <Building2 className="h-4 w-4" />
              {org.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => navigate("/organizations")}>
          <Plus className="h-4 w-4" />
          Create organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}