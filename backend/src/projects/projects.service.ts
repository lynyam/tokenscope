import { HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ApiException } from '../common/errors/api.exception';
import { CreateProjectDto } from "./dto/create-project.dto";
import { OrganizationAccessService } from "../memberships/organization-access.service";
import { MembershipRole as Role } from "../generated/prisma/enums";
import { ProjectAccessService } from "./project-access.service";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { Prisma, type MembershipRole } from "../generated/prisma/client";

const READ_ROLES: readonly MembershipRole[] = [
    Role.OWNER,
    Role.ADMIN,
    Role.MEMBER,
];

const WRITE_ROLES: readonly MembershipRole[] = [
    Role.OWNER,
    Role.ADMIN,
];

const MAX_TRANSACTION_ATTEMPTS = 3;

@Injectable()
export class ProjectsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly organizationAccess: OrganizationAccessService,
        private readonly projectAccess: ProjectAccessService,
    ) { }
    async findAllForOrganization(userId: string, organizationId: string) {
        await this.organizationAccess.assertOrganizationMember(userId, organizationId);
        // Repeat membership in the actual query because it can change
        // after the helper's first read.
        return this.prisma.project.findMany({
            where: {
                organizationId,
                archivedAt: null,
                organization: {
                    archivedAt: null,
                    memberships: { some: { userId } },
                },
            },
            orderBy: [
                { createdAt: "asc" },
                { id: "asc" },
            ],
        });
    }

    async create(userId: string, organizationId: string, dto: CreateProjectDto) {
        const slug = dto.name.toLowerCase().replace(/\s+/g, "-");
        try {
            // The organization helper  accepts tx.
            // Every serialization retry repeats the role check and creation
            // in one transaction; no role is taken from the JWT or DTO.
            return await this.runSerializable(async tx => {
                await this.organizationAccess.assertOrganizationRole(
                    userId,
                    organizationId,
                    WRITE_ROLES,
                    tx,
                );

                return tx.project.create({
                    data: {
                        organizationId,
                        name: dto.name,
                        slug,
                        description: dto.description || null,
                    },
                });
            });
        } catch (error) {
            // The unique database index handles simultaneous requests and
            // also keeps an archived project's slug reserved.
            if (this.isProjectSlugConflict(error)) {
                throw new ApiException(
                    HttpStatus.CONFLICT,
                    "PROJECT_SLUG_CONFLICT",
                    "A project already uses this slug in this organization.",
                );
            }
            throw error;
        }
    }
    async findOneForOrganization(userId: string, organizationId: string, projectId: string) {
        return this.projectAccess.assertProjectAccess(
            userId,
            organizationId,
            projectId,
            READ_ROLES,
        );
    }

    async update(
        userId: string,
        organizationId: string,
        projectId: string,
        dto: UpdateProjectDto,
    ) {
        const data: { name?: string; description?: string | null } = {};

        if (dto.name !== undefined) {
            data.name = dto.name;
        }

        if (dto.description !== undefined) {
            // null or a trimmed empty string clears the description.
            data.description = dto.description || null;
        }

        if (Object.keys(data).length === 0) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "VALIDATION_ERROR",
                "Request validation failed.",
                [{
                    field: "body",
                    messages: ["At least one field must be supplied."],
                }],
            );
        }

        await this.projectAccess.assertProjectAccess(
            userId,
            organizationId,
            projectId,
            WRITE_ROLES,
        );

        try {
            // The write itself requires the same tenant, active state,
            // actor, and role. The earlier helper read alone is insufficient.
            return await this.prisma.project.update({
                where: this.activeWritableProject(
                    userId,
                    organizationId,
                    projectId,
                ),
                data,
            });
        } catch (error) {
            if (this.isRecordNotFound(error)) {
                await this.resolveFailedWrite(
                    userId,
                    organizationId,
                    projectId,
                );
            }
            throw error;
        }
    }

    async archive(userId: string, organizationId: string, projectId: string): Promise<void> {
        await this.projectAccess.assertProjectAccess(
            userId,
            organizationId,
            projectId,
            WRITE_ROLES,
        );

        try {
            // Soft archive leaves the row and slug reservation in place.
            await this.prisma.project.update({
                where: this.activeWritableProject(
                    userId,
                    organizationId,
                    projectId,
                ),
                data: { archivedAt: new Date() },
            });
        } catch (error) {
            if (this.isRecordNotFound(error)) {
                await this.resolveFailedWrite(
                    userId,
                    organizationId,
                    projectId,
                );
            }
            throw error;
        }
    }

    private activeWritableProject(
        userId: string,
        organizationId: string,
        projectId: string,
    ): Prisma.ProjectWhereUniqueInput {
        return {
            id: projectId,
            organizationId,
            archivedAt: null,
            organization: {
                archivedAt: null,
                memberships: {
                    some: {
                        userId,
                        role: { in: [...WRITE_ROLES] },
                    },
                },
            },
        };
    }

    private async resolveFailedWrite(
        userId: string,
        organizationId: string,
        projectId: string,
    ): Promise<never> {
        // Recheck once to distinguish a lost role (403) from a project
        // or membership that is now hidden (404). Never retry the write.
        await this.projectAccess.assertProjectAccess(
            userId,
            organizationId,
            projectId,
            WRITE_ROLES,
        );

        throw new ApiException(
            HttpStatus.NOT_FOUND,
            "PROJECT_NOT_FOUND",
            "Project not found.",
        );
    }

    private async runSerializable<T>(
        operation: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> {
        for (let attempt = 1; ; attempt += 1) {
            try {
                return await this.prisma.$transaction(operation, {
                    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                });
            } catch (error) {
                if (
                    !this.isRetryableTransactionError(error) ||
                    attempt >= MAX_TRANSACTION_ATTEMPTS
                ) {
                    throw error;
                }
            }
        }
    }

    private isRetryableTransactionError(error: unknown): boolean {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            return error.code === "P2034";
        }

        // Current PostgreSQL adapter can expose this form.
        if (
            typeof error !== "object" ||
            error === null ||
            !("name" in error) ||
            error.name !== "DriverAdapterError" ||
            !("cause" in error)
        ) {
            return false;
        }

        const cause = error.cause;
        return typeof cause === "object" &&
            cause !== null &&
            "kind" in cause &&
            cause.kind === "TransactionWriteConflict";
    }

    private isRecordNotFound(error: unknown): boolean {
        return error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2025";
    }

    private isProjectSlugConflict(error: unknown): boolean {
        if (
            !(error instanceof Prisma.PrismaClientKnownRequestError) ||
            error.code !== "P2002"
        ) {
            return false;
        }

        const meta = error.meta as {
            modelName?: string;
            target?: unknown;
            driverAdapterError?: {
                cause?: {
                    kind?: string;
                    constraint?: { fields?: unknown };
                };
            };
        } | undefined;

        if (meta?.modelName && meta.modelName !== "Project") {
            return false;
        }

        if (meta?.target === "Project_organizationId_slug_key") {
            return true;
        }

        const cause = meta?.driverAdapterError?.cause;
        const fields = Array.isArray(meta?.target)
            ? meta.target
            : cause?.kind === "UniqueConstraintViolation"
                ? cause.constraint?.fields
                : undefined;

        if (!Array.isArray(fields)) {
            return false;
        }

        const names = fields.map(field =>
            typeof field === "string"
                ? field.replace(/^"(.*)"$/, "$1")
                : field,
        );

        return names.length === 2 &&
            names.includes("organizationId") &&
            names.includes("slug");
    }
}
