import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Patch,
	Post,
} from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { UuidParam } from "../common/decorators/uuid-param.decorators";
import type { AuthenticatedUser } from "../common/types/authenticated-user";
import { AddMemberDto } from "./dto/add-member.dto";
import { UpdateMemberRoleDto } from "./dto/update-member-role.dto";
import type {
	MembershipListResponse,
	MembershipResponse,
} from "./membership.mapper";
import { MembershipsService } from "./memberships.service";

@Controller("organizations/:organizationId/members")
export class MembershipsController {
	constructor(private readonly memberships: MembershipsService) { }

	@Get()
	list(
		@CurrentUser() user: AuthenticatedUser,
		@UuidParam("organizationId") organizationId: string,
	): Promise<MembershipListResponse> {
		return this.memberships.list(user.id, organizationId);
	}

	@Post()
	@HttpCode(HttpStatus.CREATED)
	add(
		@CurrentUser() user: AuthenticatedUser,
		@UuidParam("organizationId") organizationId: string,
		@Body() dto: AddMemberDto,
	): Promise<MembershipResponse> {
		return this.memberships.add(user.id, organizationId, dto);
	}

	@Patch(":userId")
	updateRole(
		@CurrentUser() user: AuthenticatedUser,
		@UuidParam("organizationId") organizationId: string,
		@UuidParam("userId") targetUserId: string,
		@Body() dto: UpdateMemberRoleDto,
	): Promise<MembershipResponse> {
		return this.memberships.updateRole(
			user.id,
			organizationId,
			targetUserId,
			dto,
		);
	}

	@Delete(":userId")
	@HttpCode(HttpStatus.NO_CONTENT)
	remove(
		@CurrentUser() user: AuthenticatedUser,
		@UuidParam("organizationId") organizationId: string,
		@UuidParam("userId") targetUserId: string,
	): Promise<void> {
		return this.memberships.remove(
			user.id,
			organizationId,
			targetUserId,
		);
	}
}
