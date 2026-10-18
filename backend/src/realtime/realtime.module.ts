import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { ProjectsModule } from "../projects/projects.module";
import { TracesModule } from "../traces/traces.module";
import { AccessChangesModule } from "../access-changes/access-changes.module";
import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeService } from "./realtime.service";

@Module({
  imports: [AuthModule, DatabaseModule, ProjectsModule, TracesModule, AccessChangesModule],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
