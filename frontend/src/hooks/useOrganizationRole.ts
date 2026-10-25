import { useEffect, useState } from "react";
import { getOrganization } from "../api/organizations.api";
import type { MembershipRole } from "../types/workspace.types";

/** Current user's role in one organization; null while unknown or when it cannot be read. */
export function useOrganizationRole(organizationId?: string, enabled = true): MembershipRole | null {
	const [state, setState] = useState<{ organizationId?: string; role: MembershipRole | null }>({ role: null });

	useEffect(() => {
		if (!organizationId || !enabled) return;
		const controller = new AbortController();
		getOrganization(organizationId, controller.signal)
			.then(organization => {
				if (!controller.signal.aborted) setState({ organizationId, role: organization.currentUserRole });
			})
			.catch(() => {
				if (!controller.signal.aborted) setState({ organizationId, role: null });
			});
		return () => controller.abort();
	}, [organizationId, enabled]);

	return enabled && state.organizationId === organizationId ? state.role : null;
}