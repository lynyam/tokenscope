import { AccessChangesModule } from "../access-changes/access-changes.module";
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { MembershipsModule } from "../memberships/memberships.module";
import { ProjectAccessService } from "./project-access.service";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

@Module({
        imports: [
                AccessChangesModule,
                DatabaseModule,
                MembershipsModule,
        ],
        controllers: [ProjectsController],
        providers: [ProjectAccessService, ProjectsService],
        exports: [ProjectAccessService],
})
export class ProjectsModule {}
