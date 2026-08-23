import { RoleBadge } from "./RoleBadge";
import type { MembershipWithUser } from "../../types/workspace.types";

type MembersTableProps = {
	memberships: MembershipWithUser[],
	canManageMembers: boolean;
}


export function MembersTable({memberships, canManageMembers} : MembersTableProps) {
	return (
		<table>
			<thead>
				<tr>
					<th scope="col">Name</th>
					<th scope="col">Email</th>
					<th scope="col">Role</th>
					{canManageMembers && (
						<th scope="col">Actions</th>
					)}
				</tr>
			</thead>
			<tbody>
				{memberships.map((membership) => {
					return (
						<tr key={membership.id}>
							<th scope="row">{membership.user.displayName}</th>
							<td>{membership.user.email}</td>
							<td><RoleBadge role={membership.role} /></td>
							{canManageMembers && (
								<td>
									<button type="button" disabled>
										Change role
									</button>
									<button type="button" disabled>
										Remove
									</button>
								</td>
							)}
						</tr>
					)}
				)}
			</tbody>
		</table>
	)
}
/* to do: button is disabled temporary, in the future I will delete it and change it
with  handle it by click
oneClick={handleRemove}
*/
