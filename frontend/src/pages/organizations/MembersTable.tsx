import { useState } from "react";
import {
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "../../components/RoleBadge";
import type { MembershipWithUser, MembershipRole } from "../../types/workspace.types";
import { updateOrganizationMemberRole, removeOrganizationMember } from "../../api/memberships.api";
import { MockApiError } from "../../api/mock-api.utils";

type EditingRoleState = {
    membershipId: string;
    role: MembershipRole;
    isSubmitting: boolean;
} | null;

type MembersTableProps = {
    organizationId: string;
    memberships: MembershipWithUser[];
    canManageMembers: boolean;
    onChangeRole: (updatedMembership: MembershipWithUser) => void;
    onMemberRemoved: (removedMembership: MembershipWithUser) => void;
};

const ROLE_OPTIONS: MembershipRole[] = ["OWNER", "ADMIN", "MEMBER"];

export function MembersTable({
    organizationId,
    memberships,
    canManageMembers,
    onChangeRole,
    onMemberRemoved,
}: MembersTableProps) {
    const [editingRole, setEditingRole] = useState<EditingRoleState>(null);
    const [roleError, setRoleError] = useState<string | null>(null);
    const [removingMembershipId, setRemovingMembershipId] = useState<string | null>(null);
    const [removeError, setRemoveError] = useState<string | null>(null);

    function handleStartEditRole(membership: MembershipWithUser) {
        setRoleError(null);
        setEditingRole({
            membershipId: membership.id,
            role: membership.role,
            isSubmitting: false,
        });
    }

    function handleCancelEditRole() {
        setEditingRole(null);
        setRoleError(null);
    }

    function handleRoleSelectChange(newRole: MembershipRole) {
        setEditingRole((previous) => {
            if (!previous) return previous;
            return { ...previous, role: newRole };
        });
    }

    async function handleConfirmRoleChange(membership: MembershipWithUser) {
        if (!editingRole) return;

        setRoleError(null);
        setEditingRole((previous) => (previous ? { ...previous, isSubmitting: true } : previous));

        try {
            const updatedMembership = await updateOrganizationMemberRole(
                organizationId,
                membership.userId,
                { role: editingRole.role }
            );
            onChangeRole(updatedMembership);
            setEditingRole(null);
        } catch (error) {
            setRoleError(error instanceof MockApiError ? error.message : "Une erreur inattendue est survenue.");
            setEditingRole((previous) => (previous ? { ...previous, isSubmitting: false } : previous));
        }
    }

    async function handleRemoveMember(membership: MembershipWithUser) {
        const confirmed = window.confirm(
            `Retirer ${membership.user.displayName} de cette organisation ?`
        );
        if (!confirmed) return;

        setRemoveError(null);
        setRemovingMembershipId(membership.id);

        try {
            await removeOrganizationMember(organizationId, membership.userId);
            onMemberRemoved(membership);
        } catch (error) {
            setRemoveError(error instanceof MockApiError ? error.message : "Une erreur inattendue est survenue.");
        } finally {
            setRemovingMembershipId(null);
        }
    }

    return (
        <div className="border rounded-lg mt-6">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        {canManageMembers && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {memberships.map((membership) => {
                        const isEditingThisRow = editingRole?.membershipId === membership.id;
                        const isRemovingThisRow = removingMembershipId === membership.id;
                        const isRowBusy =
                            isRemovingThisRow ||
                            (editingRole?.membershipId === membership.id && editingRole.isSubmitting);

                        return (
                            <TableRow key={membership.id}>
                                <TableCell className="font-medium">{membership.user.displayName}</TableCell>
                                <TableCell className="text-muted-foreground">{membership.user.email}</TableCell>
                                <TableCell>
                                    {isEditingThisRow ? (
                                        <select
                                            value={editingRole.role}
                                            disabled={editingRole.isSubmitting}
                                            onChange={(event) =>
                                                handleRoleSelectChange(event.target.value as MembershipRole)
                                            }
                                            className="rounded-lg border border-border bg-transparent h-9 px-2 text-sm"
                                        >
                                            {ROLE_OPTIONS.map((roleOption) => (
                                                <option key={roleOption} value={roleOption}>
                                                    {roleOption}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <RoleBadge role={membership.role} />
                                    )}
                                </TableCell>
                                {canManageMembers && (
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            {isEditingThisRow ? (
                                                <>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={editingRole.isSubmitting}
                                                        onClick={() => handleConfirmRoleChange(membership)}
                                                    >
                                                        {editingRole.isSubmitting ? "En cours..." : "Confirmer"}
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={editingRole.isSubmitting}
                                                        onClick={handleCancelEditRole}
                                                    >
                                                        Annuler
                                                    </Button>
                                                </>
                                            ) : (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={editingRole !== null || isRowBusy}
                                                    onClick={() => handleStartEditRole(membership)}
                                                >
                                                    Change role
                                                </Button>
                                            )}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={isRowBusy || editingRole !== null}
                                                onClick={() => handleRemoveMember(membership)}
                                            >
                                                {isRemovingThisRow ? "En cours..." : "Remove"}
                                            </Button>
                                        </div>
                                    </TableCell>
                                )}
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
            {roleError && <p role="alert" className="p-3 text-sm text-destructive">{roleError}</p>}
            {removeError && <p role="alert" className="p-3 text-sm text-destructive">{removeError}</p>}
        </div>
    );
}