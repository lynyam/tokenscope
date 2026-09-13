import { HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ApiException } from '../common/errors/api.exception';
import { CreateOrganizationDto } from "./dto/create-organization.dto";

@Injectable()
export class OrganizationsService {
    constructor(private readonly prisma: PrismaService) {}
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
        const membership = await this.prisma.membership.findUnique({
            //va chercher le Membership précis de cet utilisateur pour cette organisation — s'il n'existe pas, on renvoie la même erreur 404.
            where: {
                organizationId_userId: { organizationId, userId },
            },
            include: { organization: true },
        });
        if (!membership) {
            throw new ApiException(
                HttpStatus.NOT_FOUND,
                'ORGANIZATION_NOT_FOUND',
                'Organization not found.');
            }
            return {
                id: membership.organization.id,
                name: membership.organization.name,
                slug: membership.organization.slug,
                createdAt: membership.organization.createdAt,
                updatedAt: membership.organization.updatedAt,
                currentUserRole: membership.role,
            };
    }
    async create(userId: string, dto: CreateOrganizationDto) {
        const slug = dto.name.toLowerCase().replace(/\s+/g, "-");
        const organization = await this.prisma.organization.create({
            data: {
                name: dto.name,
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
