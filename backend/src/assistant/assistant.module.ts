import { Module } from "@nestjs/common";

import { AnalyticsModule } from "../analytics/analytics.module";
import { RateLimitModule } from "../common/rate-limit/rate-limit.module";
import { DatabaseModule } from "../database/database.module";
import { ProjectsModule } from "../projects/projects.module";
import { AssistantController } from "./assistant.controller";
import { ASSISTANT_PROVIDER } from "./assistant.provider";
import { AssistantService } from "./assistant.service";
import { GeminiAssistantProvider } from "./gemini-assistant.provider";

@Module({
	imports: [DatabaseModule, ProjectsModule, AnalyticsModule, RateLimitModule],
	controllers: [AssistantController],
	providers: [
		AssistantService,
		{ provide: ASSISTANT_PROVIDER, useClass: GeminiAssistantProvider },
	],
})
export class AssistantModule { }
