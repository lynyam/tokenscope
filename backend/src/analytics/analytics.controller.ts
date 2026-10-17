import {
	Controller,
	Get,
	Header,
	Query,
	UseInterceptors,
} from "@nestjs/common";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { UuidParam } from "../common/decorators/uuid-param.decorators";

import type {
	AuthenticatedUser,
} from "../common/types/authenticated-user";

import {
	ProjectReadLimitInterceptor,
} from "../common/rate-limit/project-read-limit.interceptor";

import { AnalyticsService } from "./analytics.service";
import { AnalyticsQueryPipe } from "./dto/analytics-query.dto";

import type {
	ResolvedAnalyticsQuery,
} from "./analytics.types";

// Existing global JWT guard protects this route.
@Controller(
	"organizations/:organizationId/projects/:projectId/analytics",
)
@UseInterceptors(ProjectReadLimitInterceptor)
export class AnalyticsController {
	constructor(
		private readonly analytics: AnalyticsService,
	) { }

	@Get()
	@Header("Cache-Control", "no-store")
	get(
		@CurrentUser() actor: AuthenticatedUser,
		@UuidParam("organizationId") organizationId: string,
		@UuidParam("projectId") projectId: string,
		@Query(AnalyticsQueryPipe) query: ResolvedAnalyticsQuery,
	) {
		return this.analytics.getSnapshot(
			{
				actorId: actor.id,
				organizationId,
				projectId,
			},
			query,
		);
	}
}
