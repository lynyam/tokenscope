import "./RoleBadge.css"
import type { MembershipRole } from "../../types/workspace.types";

type RoleBadgeProps = {
	role : MembershipRole,
}

const roleClassName : Record<MembershipRole, string> = {
	OWNER: "role-badge--owner",
	ADMIN: "role-badge--admin",
	MEMBER: "role-badge--member",
}

export function RoleBadge({ role }: RoleBadgeProps) {
	return (
		<span className= {`role-badge ${roleClassName[role]}`}>
			{role}
		</span>
	);
}
