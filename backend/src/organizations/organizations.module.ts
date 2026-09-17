import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';

@Module({
    imports: [DatabaseModule, AuthModule, MembershipsModule],
    controllers: [OrganizationsController],
    providers: [OrganizationsService],
})
export class OrganizationsModule {}