import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module";
import { DatabaseModule } from "../database/database.module";
import { PricingModule } from "../pricing/pricing.module";
import { ProjectsModule } from "../projects/projects.module";
import { RateLimitModule } from "../common/rate-limit/rate-limit.module";
import { TracePayloadPipe } from "./dto/create-trace.dto";
import { TraceQueryPipe } from "./dto/trace-query.dto";
import { PublicTracesController } from "./public-traces.controller";
import { TracesController } from "./traces.controller";
import { TraceBodyInterceptor } from "./trace-body.interceptor";
import { TraceChangesService } from "./trace-changes.service";
import { TraceReadsService } from "./trace-reads.service";
import { TracesService } from "./traces.service";

@Module({
	imports: [
		DatabaseModule,
		ApiKeysModule,
		PricingModule,
		ProjectsModule,
		RateLimitModule,
	],
	controllers: [
		PublicTracesController,
		TracesController,
	],
	providers: [
		TracePayloadPipe,
		TraceQueryPipe,
		TraceBodyInterceptor,
		TraceChangesService,
		TraceReadsService,
		TracesService,
	],
	exports: [
		TracesService,
		TraceChangesService,
	],
})
export class TracesModule {}