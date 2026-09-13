import { Module } from "@nestjs/common"
import { ConfigurationModule } from "./config/configuration.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module"
import { OrganizationsModule } from "./organizations/organizations.module";

@Module({
	imports: [ConfigurationModule, HealthModule, AuthModule, OrganizationsModule],
})
export class AppModule {}
