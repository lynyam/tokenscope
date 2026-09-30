import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { RoleBadge } from "../../components/RoleBadge";
import { Button } from "@/components/ui/button";
import type { MembershipWithUser, MembershipRole } from "../../types/workspace.types";
import { useRef, useState } from "react";
import { getApiErrorMessage, isAbortError } from "../../api/http-client";

interface MembersTableProps {
  memberships: MembershipWithUser[];
  canManageMembers: boolean;
  onChangeRole: (userId: string, role: MembershipRole) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
};

export function MembersTable({
  memberships,
  canManageMembers,
  onChangeRole,
  onRemove,
}: MembersTableProps) {
  const [editing, setEditing] = useState<{ userId: string; role: MembershipRole } | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  async function changeRole() {
    if (!editing || submitting.current) return;
    submitting.current = true;
    setPendingUserId(editing.userId);
    setError(null);
    try {
      await onChangeRole(editing.userId, editing.role);
      setEditing(null);
    } catch (failure) {
      if (!isAbortError(failure)) setError(getApiErrorMessage(failure, "Unable to change the role. Please try again."));
    } finally {
      submitting.current = false;
      setPendingUserId(null);
    }
  }

  async function removeMember(member: MembershipWithUser) {
    if (submitting.current || !window.confirm("Remove " + member.user.displayName + " from this organization?")) return;
    submitting.current = true;
    setPendingUserId(member.userId);
    setError(null);
    try {
      await onRemove(member.userId);
    } catch (failure) {
      if (!isAbortError(failure)) setError(getApiErrorMessage(failure, "Unable to remove the member. Please try again."));
    } finally {
      submitting.current = false;
      setPendingUserId(null);
    }
  }

  return (
    <div className="border rounded-lg mt-6">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead>
          {canManageMembers && <TableHead className="text-right">Actions</TableHead>}
        </TableRow></TableHeader>
        <TableBody>
          {memberships.map(member => {
            const isEditing = canManageMembers && editing?.userId === member.userId;
            const isPending = pendingUserId === member.userId;
            return (
              <TableRow key={member.id}>
                <TableCell className="font-medium">{member.user.displayName}</TableCell>
                <TableCell className="text-muted-foreground">{member.user.email}</TableCell>
                <TableCell>
                  {isEditing ? (
                    <select aria-label={"Role for " + member.user.displayName} value={editing.role}
                      disabled={pendingUserId !== null}
                      onChange={event => setEditing({ userId: member.userId, role: event.target.value as MembershipRole })}
                      className="rounded-lg border border-border bg-transparent h-9 px-2">
                      <option value="OWNER">Owner</option><option value="ADMIN">Admin</option><option value="MEMBER">Member</option>
                    </select>
                  ) : <RoleBadge role={member.role} />}
                </TableCell>
                {canManageMembers && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {isEditing ? <>
                        <Button variant="outline" size="sm" disabled={pendingUserId !== null} onClick={changeRole}>
                          {isPending ? "Saving…" : "Confirm"}
                        </Button>
                        <Button variant="outline" size="sm" disabled={pendingUserId !== null}
                          onClick={() => { setEditing(null); setError(null); }}>Cancel</Button>
                      </> : (
                        <Button variant="outline" size="sm" disabled={pendingUserId !== null || editing !== null}
                          onClick={() => { setEditing({ userId: member.userId, role: member.role }); setError(null); }}>
                          Change role
                        </Button>
                      )}
                      <Button variant="outline" size="sm" disabled={pendingUserId !== null || editing !== null}
                        onClick={() => removeMember(member)}>{isPending && !isEditing ? "Removing…" : "Remove"}</Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {error && <p role="alert" className="p-3 text-sm text-destructive">{error}</p>}
    </div>
  );
}
