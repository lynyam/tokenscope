import { Transform } from "class-transformer";
import { IsEmail, IsEnum, IsString, MaxLength } from "class-validator";
import { MembershipRole } from "../../generated/prisma/client";

export class AddMemberDto {
	@Transform(
		({ value }) =>
			typeof value === "string" ? value.trim().toLowerCase() : value,
		{ toClassOnly: true },
	)
	@IsString()
	@IsEmail()
	@MaxLength(254)
	email!: string;

	@IsEnum(MembershipRole)
	role: MembershipRole = MembershipRole.MEMBER;
}
