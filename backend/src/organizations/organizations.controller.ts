import { Body, Controller, Get, Patch, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../common/types/authenticated-user";
import { CreateOrganizationDto } from "./dto/create-organization.dto";
import { RenameOrganizationDto } from "./dto/rename-organization.dto";
import { UuidParam } from "../common/decorators/uuid-param.decorators";
import { OrganizationsService } from "./organizations.service";

@Controller("organizations")
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
	constructor(private readonly organizationsService: OrganizationsService) {}
	@Post()
	create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrganizationDto) {
		return this.organizationsService.create(user.id, dto);
	}

	@Get()
	findAll(@CurrentUser() user: AuthenticatedUser) {
		return this.organizationsService.findAllForUser(user.id);
	}

	@Get(":organizationId")
	findOne(
		@CurrentUser() user: AuthenticatedUser,
		@UuidParam("organizationId") organizationId: string,
	) {
		return this.organizationsService.findOneForUser(user.id, organizationId);
	}

	@Patch(":organizationId")
	rename(
		@CurrentUser() user: AuthenticatedUser,
		@UuidParam("organizationId") organizationId: string,
		@Body() dto: RenameOrganizationDto,
	) {
		return this.organizationsService.rename(user.id, organizationId, dto);
	}
}
