import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { getOrganizationMemberships } from "../../api/memberships.api";
import type { OrganizationMembershipsResponse } from "../../types/workspace.types";
import { MockApiError } from "../../api/mock-api.utils";

import { AddMemberForm } from "./AddMemberForm";
import { MembersTable } from "./MembersTable";
import { FolderX, ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { CircleAlert } from "lucide-react";

type RequestStatus = "loading" | "success" | "error";

export function MembersPage() {
  const { organizationId } = useParams();
  const [membershipData, setMembershipData] =
    useState<OrganizationMembershipsResponse | null>(null);
  const [requestStatus, setRequestStatus] = useState<RequestStatus>("loading");
  const [loadError, setLoadError] = useState<MockApiError | null>(null);
  useEffect(() => {
    if (!organizationId) return;
    let ignore = false;
    async function loadMemberships(validOrganizationId: string) {
      setMembershipData(null);
      setLoadError(null);
      setRequestStatus("loading");

      try {
        const response = await getOrganizationMemberships(validOrganizationId);
        if (ignore) return;
        setMembershipData(response);
        setRequestStatus("success");
      } catch (error: unknown) {
        if (ignore) {
          return;
        }
        setMembershipData(null);
        setLoadError(error instanceof MockApiError ? error : null);
        setRequestStatus("error");
      }
    }
    loadMemberships(organizationId);
    return () => {
      ignore = true;
    };
  }, [organizationId]);

  if (!organizationId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center mb-6">
        <FolderX className="h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-xl font-semibold">Missing organization</p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          No organization was specified in the URL.
        </p>
        <Link
          to="/organizations"
          className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-transparent hover:bg-muted h-10 px-6 text-sm font-medium normal-case transition-all"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to organizations
        </Link>
      </div>
    );
  }

  if (requestStatus === "loading") {
    return (
      <>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      </>
    );
  }

  if (requestStatus === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center mb-6">
        <CircleAlert className="h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-xl font-semibold">Something went wrong</p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {loadError?.message ?? "Unable to load members."}
        </p>
        <Link
          to="/organizations"
          className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-transparent hover:bg-muted h-10 px-6 text-sm font-medium normal-case transition-all"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to organizations
        </Link>
      </div>
    );
  }

  if (!membershipData) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center mb-6">
        <FolderX className="h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-xl font-semibold">No data available</p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Membership data is unavailable.
        </p>
      </div>
    );
  }
  const canManageMembers = membershipData.currentUserRole === "OWNER";
  return (
    <section>
      <div className="items-center flex justify-between">
        <h1 className="text-2xl font-semibold">Organization members</h1>
        {canManageMembers && <AddMemberForm />}
      </div>
      <p className="text-sm text-muted-foreground">
        {membershipData.memberships.length} people have access to this
        organization
      </p>
      {membershipData.memberships.length === 0 ? (
        <p>No member yet.</p>
      ) : (
        <MembersTable
          memberships={membershipData.memberships}
          canManageMembers={canManageMembers}
        />
      )}
    </section>
  );
}
