import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { MembershipsModule } from "../memberships/memberships.module";
import { ProjectAccessService } from "./project-access.service";

@Module({
	imports: [
		DatabaseModule,
		MembershipsModule,
	],
	providers: [ProjectAccessService],
	exports: [ProjectAccessService],
})
export class ProjectsModule {}
