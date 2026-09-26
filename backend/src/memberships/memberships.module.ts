import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { OrganizationAccessService } from "./organization-access.service";

@Module({
	imports: [DatabaseModule],
	providers: [OrganizationAccessService],
	exports: [OrganizationAccessService],
})
export class MembershipsModule {}
