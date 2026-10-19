import { AccessChangesModule } from "../access-changes/access-changes.module";
import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { DatabaseModule } from '../database/database.module';
import { MembershipsModule } from '../memberships/memberships.module';

@Module({
	imports: [AccessChangesModule, DatabaseModule, MembershipsModule],
	controllers: [OrganizationsController],
	providers: [OrganizationsService],
})
export class OrganizationsModule {}
