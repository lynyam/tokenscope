import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { getOrganizationMemberships } from "../../api/memberships.api";
import type { OrganizationMembershipsResponse, MembershipWithUser } from "../../types/workspace.types";
import { MockApiError } from "../../api/mock-api.utils";

import { AddMemberForm } from "./AddMemberForm";
import { MembersTable } from "./MembersTable";
import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "../../hooks/useCurrentUser";

type RequestStatus = "loading" | "success"| "error";

export function MembersPage() {
	const { organizationId } = useParams();
	const navigate = useNavigate();
    const { user: currentUser } = useCurrentUser();
	const [membershipData, setMembershipData] = useState<OrganizationMembershipsResponse | null>(null);
	const [requestStatus, setRequestStatus] = useState<RequestStatus>("loading");
	const [loadError, setLoadError] = useState<MockApiError | null>(null);
	useEffect(() => {
		if (!organizationId)
			return ;
		let ignore = false;
		async function loadMemberships(validOrganizationId: string) {
			setMembershipData(null);
			setLoadError(null);
			setRequestStatus("loading");

			try {
				const response = await getOrganizationMemberships(validOrganizationId);
				if (ignore)
					return;
				setMembershipData(response);
				setRequestStatus("success");
			} catch (error: unknown){
				if (ignore) {
					return;
				}
				setMembershipData(null);
				setLoadError(
					error instanceof MockApiError ? error : null,
				);
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
			<p>Missing organization</p>
		);
	}
	if (requestStatus === "loading") {
		return (
			<p>Loading...</p>
		);
	}
	if (requestStatus === "error") {
		return (
			<p>
				{loadError?.message ?? "Unable to load members."}
			</p>
		);
	}
	if (!membershipData) {
		return (
			<p>Membership data is unavailable.</p>
		);
	}
	const canManageMembers = membershipData.currentUserRole === "OWNER";
	function handleMemberAdded(newMembership: MembershipWithUser) {
    	setMembershipData((previous) => {
        	if (!previous) return previous;
        	return {
            	...previous,
            	memberships: [...previous.memberships, newMembership],
        	};
    	});
	}
	function handleRoleChanged(updatedMembership: MembershipWithUser) {
		setMembershipData((previous) => {
        	if (!previous) return previous;
			const isSelf = currentUser && updatedMembership.userId === currentUser.id
			return {
				...previous,
				currentUserRole: isSelf ? updatedMembership.role : previous.currentUserRole,
				memberships: previous.memberships.map((membership) =>
            		membership.id === updatedMembership.id ? updatedMembership : membership
        		),
			};
		});
	}
	function handleMemberRemoved(removedMembership: MembershipWithUser) {
    	if (currentUser && removedMembership.userId === currentUser.id) {
        	navigate("/organizations");
        	return;
    	}
    	setMembershipData((previous) => {
        	if (!previous) return previous;
        	return {
            	...previous,
            	memberships: previous.memberships.filter(
                	(membership) => membership.id !== removedMembership.id
            	),
        	};
    	});
	}
	return (
		<section aria-labelledby="organization-members-heading">
			<h1 id="organization-members-heading">Organization members</h1>
			{canManageMembers && (
    		<AddMemberForm organizationId={organizationId} onMemberAdded={handleMemberAdded} />)}
			{membershipData.memberships.length === 0 ? (
				<p>No member yet.</p>
			): (<MembersTable
				organizationId={organizationId}
				memberships={membershipData.memberships}
				canManageMembers={canManageMembers}
				onChangeRole={handleRoleChanged}
				onMemberRemoved={handleMemberRemoved}
				/>
			)}
		</section>
	);
}