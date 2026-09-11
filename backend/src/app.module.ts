import { Module } from "@nestjs/common"
import { ConfigurationModule } from "./config/configuration.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module"

@Module({
	imports: [ConfigurationModule, HealthModule, AuthModule],
})
export class AppModule {}
