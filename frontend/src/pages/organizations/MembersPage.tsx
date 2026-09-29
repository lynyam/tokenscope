import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { addOrganizationMember, getOrganizationMemberships, removeOrganizationMember, updateOrganizationMemberRole } from "../../api/memberships.api";
import { getApiErrorMessage, isAbortError } from "../../api/http-client";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import type { AddOrganizationMemberInput, MembershipRole, MembershipWithUser, OrganizationMembershipsResponse } from "../../types/workspace.types";
import { AddMemberForm } from "./AddMemberForm";
import { MembersTable } from "./MembersTable";

export function MembersPage() {
  const { organizationId } = useParams();
  const { user, isLoading } = useCurrentUser();
  if (isLoading) return <p role="status">Loading…</p>;
  if (!organizationId) return <p role="alert">No organization was specified in the URL.</p>;
  if (!user) return null; // ProtectedRoute owns the sign-in redirect.

  // Remount on tenant/identity changes so old rows never render under a new URL.
  return <OrganizationMembers key={user.id + ":" + organizationId} organizationId={organizationId} currentUserId={user.id} />;
}

function OrganizationMembers({ organizationId, currentUserId }: { organizationId: string; currentUserId: string }) {
  const navigate = useNavigate();
  const [data, setData] = useState<OrganizationMembershipsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const requests = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    requests.current = controller;
    setData(null);
    setLoadError(null);
    getOrganizationMemberships(organizationId, controller.signal)
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setLoadError(getApiErrorMessage(error, "Unable to load members. Please try again."));
        }
      });
    return () => { controller.abort(); };
  }, [organizationId, retry]);

  function applyMembership(member: MembershipWithUser) {
    setData(previous => previous && ({
      ...previous,
      currentUserRole: member.userId === currentUserId ? member.role : previous.currentUserRole,
      // Use server values and keep API.md's ordering after adding a member.
      memberships: [...previous.memberships.filter(item => item.id !== member.id), member]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    }));
  }

  async function addMember(input: AddOrganizationMemberInput) {
    const signal = requests.current!.signal;
    const member = await addOrganizationMember(organizationId, input, signal);
    signal.throwIfAborted();
    applyMembership(member);
  }

  async function changeRole(userId: string, role: MembershipRole) {
    const signal = requests.current!.signal;
    const member = await updateOrganizationMemberRole(organizationId, userId, { role }, signal);
    signal.throwIfAborted();
    // Also immediately updates management controls when the caller demotes themself.
    applyMembership(member);
  }

  async function removeMember(userId: string) {
    const signal = requests.current!.signal;
    await removeOrganizationMember(organizationId, userId, signal);
    signal.throwIfAborted();
    if (userId === currentUserId) {
      // The org list reloads on mount; the switcher reloads when opened.
      navigate("/organizations", { replace: true });
      return;
    }
    setData(previous => previous && ({ ...previous, memberships: previous.memberships.filter(member => member.userId !== userId) }));
  }

  if (loadError) return (
    <section className="flex flex-col items-start gap-3">
      <h1 className="text-2xl font-semibold">Organization members</h1>
      <p role="alert">{loadError}</p>
      <Button onClick={() => setRetry(value => value + 1)}>Retry</Button>
      <Link to="/organizations">Back to organizations</Link>
    </section>
  );

  if (!data) return (
    <div role="status" aria-label="Loading members" className="flex flex-col gap-2">
      {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}
    </div>
  );

  const canManageMembers = data.currentUserRole === "OWNER";
  return (
    <section>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Organization members</h1>
        {canManageMembers && <AddMemberForm onAdd={addMember} />}
      </div>
      <p className="text-sm text-muted-foreground">{data.memberships.length} people have access to this organization</p>
      {data.memberships.length === 0 ? <p>No member yet.</p> : (
        <MembersTable memberships={data.memberships} canManageMembers={canManageMembers}
          onChangeRole={changeRole} onRemove={removeMember} />
      )}
    </section>
  );
}
