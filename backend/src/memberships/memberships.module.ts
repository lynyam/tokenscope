import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { OrganizationAccessService } from "./organization-access.service";
import { UsersModule } from "../users/users.module";
import { MembershipsService } from "./memberships.service";
import { MembershipsController } from "./memberships.controller";

@Module({
	imports: [DatabaseModule, UsersModule],
	controllers: [MembershipsController],
	providers: [OrganizationAccessService, MembershipsService],
	exports: [OrganizationAccessService],
})
export class MembershipsModule {}
