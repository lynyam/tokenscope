import {
	Body,
	Controller,
	Post,
	Res,
	UseInterceptors,
} from "@nestjs/common";
import type { Response } from "express";
import { PublicApi } from "../api-keys/public-api.decorator";
import { CurrentApiKey } from "../api-keys/current-api-key.decorator";
import type { ApiKeyPrincipal } from "../api-keys/api-key.types";
import {
	TracePayloadPipe,
	type NormalizedTracePayload,
} from "./dto/create-trace.dto";
import { TraceBodyInterceptor } from "./trace-body.interceptor";
import { TracesService } from "./traces.service";

@Controller("public/traces")
export class PublicTracesController {
	constructor(private readonly traces: TracesService) { }

	@Post()
	@PublicApi()
	@UseInterceptors(TraceBodyInterceptor)
	async create(
		@CurrentApiKey() principal: ApiKeyPrincipal,
		@Body(TracePayloadPipe) payload: NormalizedTracePayload,
		@Res({ passthrough: true }) response: Response,
	) {
		const result = await this.traces.ingest(principal, payload);

		response.status(result.created ? 201 : 200);
		response.setHeader("ETag", `"${result.trace.version}"`);

		return result.trace;
	}
}
