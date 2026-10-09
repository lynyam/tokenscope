import { Badge } from "@/components/ui/badge";
import type { MembershipRole } from "../types/workspace.types";

type RoleBadgeProps = {
  role: MembershipRole;
};

const roleClassName: Record<MembershipRole, string> = {
  OWNER: "bg-purple-100 text-purple-800 border-purple-300",
  ADMIN: "bg-blue-100 text-blue-800 border-blue-300",
  MEMBER: "bg-gray-100 text-gray-700 border-gray-300",
};

export function RoleBadge({ role }: RoleBadgeProps) {
  return (
    <Badge variant="outline" className={`text-xm px-2 py-1 ${roleClassName[role]}`}>
      {role}
    </Badge>
  );
}