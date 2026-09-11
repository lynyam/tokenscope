import { Module } from "@nestjs/common"
import { ConfigurationModule } from "./config/configuration.module";
import { HealthModule } from "./health/health.module";

@Module({
	imports: [ConfigurationModule, HealthModule],
})
export class AppModule {}
