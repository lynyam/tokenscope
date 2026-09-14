import { Module } from "@nestjs/common"
import { ConfigurationModule } from "./config/configuration.module";
import { HealthModule } from "./health/health.module";
import { MembershipsModule } from "./memberships/memberships.module";
import{ ProjectsModule } from "./projects/projects.module"

@Module({
	imports: [
		ConfigurationModule,
		HealthModule,
		MembershipsModule,
		ProjectsModule,
	],
})
export class AppModule {}
