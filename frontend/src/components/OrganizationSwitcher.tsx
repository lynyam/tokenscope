import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getOrganizations } from "@/api/organizations.api";
import type { OrganizationSummary } from "@/types/workspace.types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Building2, ChevronsUpDown, Plus } from "lucide-react";
import { getApiErrorMessage, isAbortError } from "@/api/http-client";

export function OrganizationSwitcher() {
  const { organizationId } = useParams();
  const navigate = useNavigate();
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    setIsLoading(true);
    setLoadError(null);

    getOrganizations(controller.signal)
      .then(data => {
        if (!controller.signal.aborted) setOrganizations(data);
      })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) {
          // A failed request does not mean the user has no organizations.
          setLoadError(
            getApiErrorMessage(error, "Failed to load organizations."),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    // Opening the menu again supersedes its previous request.
    return () => controller.abort();
  }, [organizationId, reload]);

  const currentOrganization = organizations.find(
    organization => organization.id === organizationId,
  );

  return (
    <DropdownMenu
      onOpenChange={open => {
        // Fetch current memberships after creation or membership changes.
        if (open) setReload(value => value + 1);
      }}
    >
      <DropdownMenuTrigger
        aria-label="Choose organization"
        className="flex w-full items-center gap-2 rounded-lg border p-2 text-left transition-colors hover:bg-muted"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
          <Building2 className="h-4 w-4 text-muted-foreground" />
        </div>

        <span className="flex-1 truncate text-sm font-medium">
          {currentOrganization?.name ?? "Select organization"}
        </span>

        <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-56 rounded-lg">
        {isLoading ? (
          <p role="status" className="p-2 text-sm">
            Loading organizations…
          </p>
        ) : loadError ? (
          <>
            <p role="alert" className="p-2 text-sm text-destructive">
              {loadError}
            </p>
            <DropdownMenuItem
              onClick={() => setReload(value => value + 1)}
            >
              Retry
            </DropdownMenuItem>
          </>
        ) : organizations.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">
            No organizations yet.
          </p>
        ) : (
          <DropdownMenuGroup>
            {organizations.map(organization => (
              <DropdownMenuItem
                key={organization.id}
                onClick={() =>
                  navigate(
                    `/organizations/${encodeURIComponent(organization.id)}`,
                  )
                }
              >
                <Building2 className="h-4 w-4" />
                {organization.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => navigate("/organizations")}>
          <Plus className="h-4 w-4" />
          Create organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
