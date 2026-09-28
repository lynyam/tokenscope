import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../common/types/authenticated-user";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { ProjectsService } from "./projects.service";
import { UuidParam } from "../common/decorators/uuid-param.decorators";

@Controller("organizations/:organizationId/projects")
export class ProjectsController {
    constructor(private readonly projectsService: ProjectsService) {}

    @Get()
    findAll(@CurrentUser() user: AuthenticatedUser, @UuidParam("organizationId") organizationId: string) {
        return this.projectsService.findAllForOrganization(user.id, organizationId);
    }

    @Post()
    create(
        @CurrentUser() user: AuthenticatedUser,
        @UuidParam("organizationId") organizationId: string,
        @Body() dto: CreateProjectDto,
    ) {
        return this.projectsService.create(user.id, organizationId, dto);
    }

    @Get(":projectId")
    findOne(
        @CurrentUser() user: AuthenticatedUser,
        @UuidParam("organizationId") organizationId: string,
        @UuidParam("projectId") projectId: string,
    ) {
        return this.projectsService.findOneForOrganization(user.id, organizationId, projectId);
    }

    @Patch(":projectId")
    update(
        @CurrentUser() user: AuthenticatedUser,
        @UuidParam("organizationId") organizationId: string,
        @UuidParam("projectId") projectId: string,
        @Body() dto: UpdateProjectDto,
    ) {
        return this.projectsService.update(user.id, organizationId, projectId, dto);
    }

    @Delete(":projectId")
    @HttpCode(HttpStatus.NO_CONTENT)
    async archive(
        @CurrentUser() user: AuthenticatedUser,
        @UuidParam("organizationId") organizationId: string,
        @UuidParam("projectId") projectId: string,
    ): Promise<void> {
        await this.projectsService.archive(user.id, organizationId, projectId);
    }
}
