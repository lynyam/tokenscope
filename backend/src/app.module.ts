import { HealthController } from "./health.controller"
import { Module } from "@nestjs/common"
import { DatabaseService } from "./database.service"

@Module({
	controllers: [HealthController],
	providers: [DatabaseService],
})
export class AppModule {}

