import { useState, type FormEvent } from "react";

import { addOrganizationMember } from "../../api/memberships.api";
import { MockApiError } from "../../api/mock-api.utils";
import type { MembershipRole, MembershipWithUser } from "../../types/workspace.types";

interface AddMemberFormProps {
    organizationId: string;
    onMemberAdded: (membership: MembershipWithUser) => void;
}

export function AddMemberForm({ organizationId, onMemberAdded }: AddMemberFormProps) {
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<MembershipRole>("MEMBER");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<MockApiError | null>(null);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); // empêcher le rechargement de page par défaut du formulaire

        setIsSubmitting(true);
        setSubmitError(null);

        try {
            const newMembership = await addOrganizationMember(organizationId, { email, role });
            onMemberAdded(newMembership);  // prévenir le parent qu'une membership a été ajoutée
            setEmail("");           // vider le champ email après succès
            setRole("MEMBER");      // remettre le rôle par défaut
        } catch (error: unknown) {
            setSubmitError(error instanceof MockApiError ? error : null);
        } finally {
            setIsSubmitting(false);
        }
    }
    return (
        <form onSubmit={handleSubmit}>
            <h2>Add member</h2>
            <label htmlFor="member-email">Email</label>
            <input
                id="member-email"
                name="email"
                type="email"
                placeholder="member@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={isSubmitting}
                required
            />
            <label htmlFor="member-role">Role</label>
			<select
    			id="member-role"
    			name="role"
    			value={role}
    			onChange={(event) => setRole(event.target.value as MembershipRole)}
    			disabled={isSubmitting}
			>
    			<option value="MEMBER">Member</option>
    			<option value="ADMIN">Admin</option>
    			<option value="OWNER">Owner</option>
			</select>
            <button type="submit" disabled={isSubmitting}>
                Add member
            </button>
            {submitError && <p role="alert">{submitError.message}</p>}
        </form>
    );
}
