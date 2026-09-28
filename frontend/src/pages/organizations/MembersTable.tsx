import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { RoleBadge } from "../../components/RoleBadge";
import { Button } from "@/components/ui/button";
import type { MembershipWithUser } from "../../types/workspace.types";

type MembersTableProps = {
  memberships: MembershipWithUser[];
  canManageMembers: boolean;
};

export function MembersTable({
  memberships,
  canManageMembers,
}: MembersTableProps) {
  return (
    <div className="border rounded-lg mt-6">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            {canManageMembers && (
              <TableHead className="text-right">Actions</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {memberships.map((membership) => (
            <TableRow key={membership.id}>
              <TableCell className="font-medium">
                {membership.user.displayName}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {membership.user.email}
              </TableCell>
              <TableCell>
                <RoleBadge role={membership.role} />
              </TableCell>
              {canManageMembers && (
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" disabled>
                      Change role
                    </Button>
                    <Button variant="outline" size="sm" disabled>
                      Remove
                    </Button>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
/* to do: button is disabled temporary, in the future I will delete it and change it
with  handle it by click
oneClick={handleRemove}
*/
