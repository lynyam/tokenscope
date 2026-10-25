import { useCallback, useEffect, useState } from "react";
import { getOrganization } from "../api/organizations.api";
import { getApiErrorMessage, isAbortError } from "../api/http-client";
import type { MembershipRole } from "../types/workspace.types";

/** Fail closed while unknown, but allow recovery from a failed permission read. */
export function useOrganizationRole(organizationId?: string, enabled = true, scope = organizationId) {
	const [state, setState] = useState<{
		organizationId?: string;
		scope?: string;
		role: MembershipRole | null;
		error: string | null;
	}>({ role: null, error: null });
	const [attempt, setAttempt] = useState(0);
	const reload = useCallback(() => setAttempt(value => value + 1), []);

	useEffect(() => {
		setState({ organizationId, scope, role: null, error: null });
		if (!organizationId || !enabled) return;
		const controller = new AbortController();
		getOrganization(organizationId, controller.signal)
			.then(organization => {
				if (!controller.signal.aborted) setState({ organizationId, scope, role: organization.currentUserRole, error: null });
			})
			.catch(failure => {
				if (controller.signal.aborted || isAbortError(failure)) return;
				setState({ organizationId, scope, role: null,
					error: getApiErrorMessage(failure, "Unable to load project permissions.") });
			});
		return () => controller.abort();
	}, [organizationId, enabled, scope, attempt]);

	return enabled && state.organizationId === organizationId && state.scope === scope
		? { role: state.role, error: state.error, reload }
		: { role: null, error: null, reload };
}
