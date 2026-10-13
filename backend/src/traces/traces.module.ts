import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module";
import { DatabaseModule } from "../database/database.module";
import { PricingModule } from "../pricing/pricing.module";
import { TracePayloadPipe } from "./dto/create-trace.dto";
import { PublicTracesController } from "./public-traces.controller";
import { TraceBodyInterceptor } from "./trace-body.interceptor";
import { TraceChangesService } from "./trace-changes.service";
import { TracesService } from "./traces.service";

@Module({
	imports: [
		DatabaseModule,
		ApiKeysModule,
		PricingModule,
	],
	controllers: [PublicTracesController],
	providers: [
		TracePayloadPipe,
		TraceBodyInterceptor,
		TraceChangesService,
		TracesService,
	],
	exports: [
		TracesService,
		TraceChangesService,
	],
})
export class TracesModule { }
