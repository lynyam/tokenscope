import { IsDefined, IsEnum } from "class-validator";
import { MembershipRole } from "../../generated/prisma/client";

export class UpdateMemberRoleDto {
	@IsDefined()
	@IsEnum(MembershipRole)
	role!: MembershipRole;
}
