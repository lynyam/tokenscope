import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { MembershipsModule } from "../memberships/memberships.module";
import { AuthModule } from "../auth/auth.module";
import { ProjectAccessService } from "./project-access.service";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

@Module({
        imports: [
                DatabaseModule,
                MembershipsModule,
                AuthModule,
        ],
        controllers: [ProjectsController],
        providers: [ProjectAccessService, ProjectsService],
        exports: [ProjectAccessService],
})
export class ProjectsModule {}
