import {
	Controller,
	Get,
	Header,
	Query,
	UseInterceptors,
} from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../common/types/authenticated-user";
import { UuidParam } from "../common/decorators/uuid-param.decorators";
import { ProjectReadLimitInterceptor } from "../common/rate-limit/project-read-limit.interceptor";
import {
	TraceQueryPipe,
	type TraceListQuery,
} from "./dto/trace-query.dto";
import { TraceReadsService } from "./trace-reads.service";

@Controller("organizations/:organizationId/projects/:projectId/traces")
@UseInterceptors(ProjectReadLimitInterceptor)
export class TracesController {
	constructor(private readonly reads: TraceReadsService) { }

	@Get()
	@Header("Cache-Control", "no-store")
	list(
		@CurrentUser() actor: AuthenticatedUser,
		@UuidParam("organizationId") organizationId: string,
		@UuidParam("projectId") projectId: string,
		@Query(TraceQueryPipe) query: TraceListQuery,
	) {
		return this.reads.listBrowser(
			actor.id,
			organizationId,
			projectId,
			query,
		);
	}

	@Get(":traceId")
	@Header("Cache-Control", "no-store")
	detail(
		@CurrentUser() actor: AuthenticatedUser,
		@UuidParam("organizationId") organizationId: string,
		@UuidParam("projectId") projectId: string,
		@UuidParam("traceId") traceId: string,
	) {
		return this.reads.detailBrowser(
			actor.id,
			organizationId,
			projectId,
			traceId,
		);
	}
}