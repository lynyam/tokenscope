import { Module } from "@nestjs/common";
import { ConfigurationModule } from "./config/configuration.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { MembershipsModule } from "./memberships/memberships.module";
import { ProjectsModule } from "./projects/projects.module";

@Module({
	imports: [
		ConfigurationModule,
		HealthModule,
		AuthModule,
		OrganizationsModule,
		MembershipsModule,
		ProjectsModule,
	],
})
export class AppModule {}
