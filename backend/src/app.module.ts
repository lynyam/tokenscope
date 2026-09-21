import { Module } from "@nestjs/common"
import { ConfigurationModule } from "./config/configuration.module";
import { HealthModule } from "./health/health.module";
import { MembershipsModule } from "./memberships/memberships.module";
import{ ProjectsModule } from "./projects/projects.module"
//auth
import { UsersModule } from "./users/users.module";
import { AuthModule } from "./auth/auth.module";

@Module({
	imports: [
		ConfigurationModule,
		HealthModule,
		MembershipsModule,
		ProjectsModule,
		UsersModule, 
		AuthModule,
	],
})
export class AppModule {}
