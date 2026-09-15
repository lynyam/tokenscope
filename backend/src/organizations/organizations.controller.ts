import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../common/types/authenticated-user";
import { CreateOrganizationDto } from "./dto/create-organization.dto";
import { OrganizationsService } from "./organizations.service";

@Controller("organizations")
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
    constructor(private readonly organizationsService: OrganizationsService) {}

    @Post()
    create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrganizationDto) {
        return this.organizationsService.create(user.userId, dto);
    }

    @Get()
    findAll(@CurrentUser() user: AuthenticatedUser) {
        return this.organizationsService.findAllForUser(user.userId);
    }

    @Get(":organizationId")
    findOne(
        @CurrentUser() user: AuthenticatedUser,
        @Param("organizationId") organizationId: string,
    ) {
        return this.organizationsService.findOneForUser(user.userId, organizationId);
    }
}