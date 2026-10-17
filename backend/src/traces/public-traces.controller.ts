import {
	Body,
	Controller,
	Delete,
	Get,
	Header,
	HttpCode,
	Post,
	Put,
	Query,
	Req,
	Res,
	UseInterceptors,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { PublicApi } from "../api-keys/public-api.decorator";
import { CurrentApiKey } from "../api-keys/current-api-key.decorator";
import type { ApiKeyPrincipal } from "../api-keys/api-key.types";
import { UuidParam } from "../common/decorators/uuid-param.decorators";
import {
	TracePayloadPipe,
	type NormalizedTracePayload,
} from "./dto/create-trace.dto";
import {
	TraceQueryPipe,
	type TraceListQuery,
} from "./dto/trace-query.dto";
import { TraceBodyInterceptor } from "./trace-body.interceptor";
import { TraceReadsService } from "./trace-reads.service";
import { TracesService } from "./traces.service";
import { singleIfMatch, traceEtag } from "./trace-version";

@Controller("public/traces")
export class PublicTracesController {
	constructor(
		private readonly traces: TracesService,
		private readonly reads: TraceReadsService,
	) { }

	@Post()
	@PublicApi()
	@Header("Cache-Control", "no-store")
	@UseInterceptors(TraceBodyInterceptor)
	async create(
		@CurrentApiKey() principal: ApiKeyPrincipal,
		@Body(TracePayloadPipe) payload: NormalizedTracePayload,
		@Res({ passthrough: true }) response: Response,
	) {
		const result = await this.traces.ingest(principal, payload);

		response.status(result.created ? 201 : 200);
		response.setHeader("ETag", traceEtag(result.trace.version));

		return result.trace;
	}

	@Get()
	@PublicApi()
	@Header("Cache-Control", "no-store")
	list(
		@CurrentApiKey() principal: ApiKeyPrincipal,
		@Query(TraceQueryPipe) query: TraceListQuery,
	) {
		return this.reads.listPublic(principal, query);
	}

	@Get(":traceId")
	@PublicApi()
	@Header("Cache-Control", "no-store")
	async detail(
		@CurrentApiKey() principal: ApiKeyPrincipal,
		@UuidParam("traceId") traceId: string,
		@Res({ passthrough: true }) response: Response,
	) {
		const trace = await this.reads.detailPublic(principal, traceId);
		response.setHeader("ETag", traceEtag(trace.version));
		return trace;
	}

	@Put(":traceId")
	@PublicApi()
	@Header("Cache-Control", "no-store")
	@UseInterceptors(TraceBodyInterceptor)
	async replace(
		@CurrentApiKey() principal: ApiKeyPrincipal,
		@UuidParam("traceId") traceId: string,
		@Body(TracePayloadPipe) payload: NormalizedTracePayload,
		@Req() request: Request,
		@Res({ passthrough: true }) response: Response,
	) {
		const trace = await this.traces.replace(
			principal,
			traceId,
			singleIfMatch(request),
			payload,
		);

		response.setHeader("ETag", traceEtag(trace.version));
		return trace;
	}

	@Delete(":traceId")
	@PublicApi()
	@HttpCode(204)
	@Header("Cache-Control", "no-store")
	async remove(
		@CurrentApiKey() principal: ApiKeyPrincipal,
		@UuidParam("traceId") traceId: string,
		@Req() request: Request,
	): Promise<void> {
		await this.traces.remove(
			principal,
			traceId,
			singleIfMatch(request),
		);
	}
}