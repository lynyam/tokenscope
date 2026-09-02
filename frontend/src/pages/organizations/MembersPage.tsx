import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { getOrganizationMemberships } from "../../api/memberships.api";
import type { OrganizationMembershipsResponse } from "../../types/workspace.types";
import { MockApiError } from "../../api/mock-api.utils";

import { AddMemberForm } from "./AddMemberForm";
import { MembersTable } from "./MembersTable";

type RequestStatus = "loading" | "success"| "error";

export function MembersPage() {
	const { organizationId } = useParams();
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
