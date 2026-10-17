import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { ProjectsModule } from "../projects/projects.module";
import { RateLimitModule } from "../common/rate-limit/rate-limit.module";

import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsQueryPipe } from "./dto/analytics-query.dto";

@Module({
	imports: [
		DatabaseModule,
		ProjectsModule,
		RateLimitModule,
	],
	controllers: [AnalyticsController],
	providers: [
		AnalyticsService,
		AnalyticsQueryPipe,
	],
	exports: [AnalyticsService],
})
export class AnalyticsModule { }
