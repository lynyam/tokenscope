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
		async function loadMembership(organizationId: string) {
			const response: OrganizationMembershipsResponse =
				await getOrganizationMemberships(organizationId);
			// to be continue.

		}
	}, [organizationId]);

  // Effect comes next.
  // Render branches come afterward.
}
