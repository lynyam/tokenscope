import { HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ApiException } from '../common/errors/api.exception';
import { CreateOrganizationDto } from "./dto/create-organization.dto";
import { OrganizationAccessService } from "../memberships/organization-access.service";

@Injectable()
export class OrganizationsService {
    constructor(private readonly prisma: PrismaService, private readonly organizationAccess: OrganizationAccessService,) {}
    async findAllForUser(userId: string) {
        //va chercher tous les Membership où userId correspond, et pour chacun, inclus aussi l'Organization associée.
        const memberships = await this.prisma.membership.findMany({
            where: { userId },
            include: { organization: true },
        });
        return memberships.map((membership) => ({
            id: membership.organization.id,
            name: membership.organization.name,
            slug: membership.organization.slug,
            createdAt: membership.organization.createdAt,
            updatedAt: membership.organization.updatedAt,
            currentUserRole: membership.role,
        }));
    }
    async findOneForUser(userId: string, organizationId: string) {
    const membership = await this.organizationAccess.assertOrganizationMember(userId, organizationId);

    const organization = await this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
    });

    return {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
        currentUserRole: membership.role,
    };
}
    async create(userId: string, dto: CreateOrganizationDto) {
        const name = dto.name.trim();
        if (!name) {
            throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "INVALID_ORGANIZATION_NAME",
                "Organization name must not be blank.",
            );
        }
        const slug = name.toLowerCase().replace(/\s+/g, "-");
        const slugAlreadyExists = await this.prisma.organization.findUnique({
            where: { slug },
        });
        if (slugAlreadyExists) {
            throw new ApiException(
                HttpStatus.CONFLICT,
                "ORGANIZATION_SLUG_CONFLICT",
                "An organization already uses this slug.",
            );
        }
        const organization = await this.prisma.organization.create({
            data: {
                name,
                slug,
                memberships: {
                    create: {
                        userId,
                        role: 'OWNER',
                    },
                },
            },
            include: { memberships: true },
        });

        return {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            createdAt: organization.createdAt,
            updatedAt: organization.updatedAt,
            currentUserRole: 'OWNER' as const,
        };
    }
}
