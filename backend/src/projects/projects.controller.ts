import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../common/types/authenticated-user";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { ProjectsService } from "./projects.service";

@Controller("organizations/:organizationId/projects")
@UseGuards(JwtAuthGuard)
export class ProjectsController {
    constructor(private readonly projectsService: ProjectsService) {}

    @Get()
    findAll(@CurrentUser() user: AuthenticatedUser, @Param("organizationId") organizationId: string) {
        return this.projectsService.findAllForOrganization(user.userId, organizationId);
    }

    @Post()
    create(
        @CurrentUser() user: AuthenticatedUser,
        @Param("organizationId") organizationId: string,
        @Body() dto: CreateProjectDto,
    ) {
        return this.projectsService.create(user.userId, organizationId, dto);
    }

    @Get(":projectId")
    findOne(
        @CurrentUser() user: AuthenticatedUser,
        @Param("organizationId") organizationId: string,
        @Param("projectId") projectId: string,
    ) {
        return this.projectsService.findOneForOrganization(user.userId, organizationId, projectId);
    }

    @Patch(":projectId")
    update(
        @CurrentUser() user: AuthenticatedUser,
        @Param("organizationId") organizationId: string,
        @Param("projectId") projectId: string,
        @Body() dto: UpdateProjectDto,
    ) {
        return this.projectsService.update(user.userId, organizationId, projectId, dto);
    }

    @Delete(":projectId")
    archive(
        @CurrentUser() user: AuthenticatedUser,
        @Param("organizationId") organizationId: string,
        @Param("projectId") projectId: string,
    ) {
        return this.projectsService.archive(user.userId, organizationId, projectId);
    }
}