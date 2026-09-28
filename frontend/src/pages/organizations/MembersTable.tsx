import { useState } from "react";
import { RoleBadge } from "../../components/RoleBadge";
import type { MembershipWithUser, MembershipRole } from "../../types/workspace.types";
import { updateOrganizationMemberRole, removeOrganizationMember } from "../../api/memberships.api";
import { MockApiError } from "../../api/mock-api.utils";
import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "../../hooks/useCurrentUser";


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
        <>
            <table>
                <thead>
                    <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Email</th>
                        <th scope="col">Role</th>
                        {canManageMembers && <th scope="col">Actions</th>}
                    </tr>
                </thead>
                <tbody>
                    {memberships.map((membership) => {
                        const isEditingThisRow = editingRole?.membershipId === membership.id;
                        const isRemovingThisRow = removingMembershipId === membership.id;
                        const isRowBusy = isRemovingThisRow || (editingRole?.membershipId === membership.id && editingRole.isSubmitting);

                        return (
                            <tr key={membership.id}>
                                <th scope="row">{membership.user.displayName}</th>
                                <td>{membership.user.email}</td>
                                <td>
                                    {isEditingThisRow ? (
                                        <select
                                            value={editingRole.role}
                                            disabled={editingRole.isSubmitting}
                                            onChange={(event) =>
                                                handleRoleSelectChange(event.target.value as MembershipRole)
                                            }
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
                                </td>
                                {canManageMembers && (
                                    <td>
                                        {isEditingThisRow ? (
                                            <>
                                                <button
                                                    type="button"
                                                    disabled={editingRole.isSubmitting}
                                                    onClick={() => handleConfirmRoleChange(membership)}
                                                >
                                                    {editingRole.isSubmitting ? "En cours..." : "Confirmer"}
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={editingRole.isSubmitting}
                                                    onClick={handleCancelEditRole}
                                                >
                                                    Annuler
                                                </button>
                                            </>
                                        ) : (
                                            <button
                                                type="button"
                                                disabled={editingRole !== null || isRowBusy}
                                                onClick={() => handleStartEditRole(membership)}
                                            >
                                                Change role
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            disabled={isRowBusy || editingRole !== null}
                                            onClick={() => handleRemoveMember(membership)}
                                        >
                                            {isRemovingThisRow ? "En cours..." : "Remove"}
                                        </button>
                                    </td>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {roleError && <p role="alert">{roleError}</p>}
            {removeError && <p role="alert">{removeError}</p>}
        </>
    );
}