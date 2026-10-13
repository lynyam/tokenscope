import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RateLimitModule } from "../common/rate-limit/rate-limit.module";
import type { EnvironmentVariables } from "../config/env.validation";
import { DatabaseModule } from "../database/database.module";
import { ProjectsModule } from "../projects/projects.module";
import {
	DocumentCleanupService,
	DocumentClock,
} from "./document-cleanup.service";
import {
	DOCUMENT_STORAGE_ROOT,
	DocumentStorageService,
} from "./document-storage.service";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";

@Module({
	imports: [DatabaseModule, ProjectsModule, RateLimitModule],
	controllers: [DocumentsController],
	providers: [
		{
			provide: DOCUMENT_STORAGE_ROOT,
			inject: [ConfigService],
			useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
				config.get("DOCUMENT_STORAGE_ROOT", { infer: true }),
		},
		DocumentStorageService,
		DocumentClock,
		DocumentCleanupService,
		DocumentsService,
	],
})
export class DocumentsModule {}
