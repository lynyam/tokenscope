import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { ProjectsModule } from "../projects/projects.module";
import { RateLimitModule } from "../common/rate-limit/rate-limit.module";
import { ClientIpService } from "../common/rate-limit/client-ip.service";
import { ApiKeysController } from "./api-keys.controller";
import { ApiKeysService } from "./api-keys.service";
import { ApiKeyAuthService } from "./api-key-auth.service";
import { ApiKeyGuard } from "./api-key.guard";

@Module({
	imports: [
		DatabaseModule,
		ProjectsModule,
		RateLimitModule,
	],
	controllers: [ApiKeysController],
	providers: [
		ApiKeysService,
		ApiKeyAuthService,
		ApiKeyGuard,
		ClientIpService,
	],
	exports: [
		ApiKeyAuthService,
		ApiKeyGuard,
		ClientIpService,
		RateLimitModule,
	],
})
export class ApiKeysModule { }
