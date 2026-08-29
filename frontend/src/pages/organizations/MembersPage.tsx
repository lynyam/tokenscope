import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { getOrganizationMemberships } from "../../api/memberships.api";
import type { OrganizationMembershipsResponse } from "../../types/workspace.types";

import { AddMemberForm } from "./AddMemberForm";
import { MembersTable } from "./MembersTable";

type RequestStatus = "loading" | "success"| "error";

export function MembersPage() {
	const { organizationId } = useParams();
	const [membershipData, setMembershipData] = useState<OrganizationMembershipsResponse | null>(null);
	const [requestStatus, setRequestStatus] = useState<RequestStatus>("loading");
	useEffect(() => {
		if (!organizationId)
			return ;
		let ignore = false;
		async function loadMemberships(validOrganizationId: string) {
			setMembershipData(null);
			setRequestStatus("loading");
			try {
				const response = await getOrganizationMemberships(validOrganizationId);
				if (ignore)
					return;
				setMembershipData(response);
				setRequestStatus("success");
			} catch {
				if (ignore) {
					return;
				}
				setMembershipData(null);
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
			<p>Members page is Loading...</p>
		);
	}
	if (requestStatus === "error") {
		return (
			<p>Unable to load members.</p>
		);
	}
	if (!membershipData) {
		return (
			<p>Membership data is unavailable.</p>
		);
	}
	const canManageMembers = membershipData.currentUserRole === "OWNER";
	return (
		<section aria-labelledby="organization-members-heading">
			<h1 id="organization-members-heading">Organization members</h1>
			{canManageMembers && <AddMemberForm />}
			{membershipData.memberships.length === 0 ? (
				<p>No member yet.</p>
			): (<MembersTable memberships={membershipData.memberships}
				canManageMembers={canManageMembers}/>
			)}
		</section>
	);
}
