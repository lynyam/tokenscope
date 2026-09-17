import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ApiException } from '../common/errors/api.exception';
import { CreateProjectDto } from "./dto/create-project.dto";
import { OrganizationAccessService } from "../memberships/organization-access.service";
import { MembershipRole } from "../generated/prisma/enums";
import { ProjectAccessService } from "./project-access.service";
import { UpdateProjectDto } from "./dto/update-project.dto";


@Injectable()
export class ProjectsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly organizationAccess: OrganizationAccessService,
        private readonly projectAccess: ProjectAccessService,
    ) {}
    async findAllForOrganization(userId: string, organizationId: string) {
        await this.organizationAccess.assertOrganizationMember(userId, organizationId);
        const projects = await this.prisma.project.findMany({
            where: {
                organizationId,
                archivedAt: null,
            },
        });
        return projects;
    }
    async create(userId: string, organizationId: string, dto: CreateProjectDto) {
        await this.organizationAccess.assertOrganizationRole(
            userId,
            organizationId,
            [MembershipRole.OWNER, MembershipRole.ADMIN],
        );
        const name = dto.name.trim();
        if (!name) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "INVALID_PROJECT_NAME",
                "Project name must not be blank.",
            );
        }
        const slug = name.toLowerCase().replace(/\s+/g, "-");
        const slugAlreadyExists = await this.prisma.project.findUnique({
            where: {
            organizationId_slug: { organizationId, slug },
            },
        });
        if (slugAlreadyExists) {
            throw new ApiException(
                HttpStatus.CONFLICT,
                "PROJECT_SLUG_CONFLICT",
                "A project already uses this slug in this organization.",
            );
        }
        const description = dto.description?.trim() || null;
        const project = await this.prisma.project.create({
        data: {
                name,
                slug,
                description,
                organizationId,
            },
        });
        return project;
    }
    async findOneForOrganization(userId: string, organizationId: string, projectId: string) {
        const project = await this.projectAccess.assertProjectAccess(
            userId,
            organizationId,
            projectId,
            [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MEMBER],
        );
        return project;
    }
    async update(userId: string, organizationId: string, projectId: string, dto: UpdateProjectDto) {
        await this.projectAccess.assertProjectAccess(
            userId,
            organizationId,
            projectId,
            [MembershipRole.OWNER, MembershipRole.ADMIN],
        );
        const data: { name?: string; description?: string | null } = {};

        if (dto.name !== undefined) {
            const name = dto.name.trim();
            if (!name) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_PROJECT_NAME", "Project name must not be blank.");
            }
            data.name = name;
        }
        if (dto.description !== undefined) {
            data.description = dto.description.trim() || null;
        }
        const project = await this.prisma.project.update({
            where: { id: projectId },
            data,
        });
        return project;
    }
    async archive(userId: string, organizationId: string, projectId: string) {
        await this.projectAccess.assertProjectAccess(
            userId,
            organizationId,
            projectId,
            [MembershipRole.OWNER, MembershipRole.ADMIN],
        );
        const project = await this.prisma.project.update({
            where: { id: projectId },
            data: { archivedAt: new Date() },
        });
        return project;
    }
}