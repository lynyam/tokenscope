import { Controller, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";

import { UuidParam } from "../common/decorators/uuid-param.decorators";
import type { AuthenticatedRequest } from "../common/types/authenticated-request";
import { AssistantService } from "./assistant.service";
import { assertBodySize, parseAskAssistantBody } from "./dto/ask-assistant.dto";

// POST /api/v1/organizations/:organizationId/projects/:projectId/assistant
// The global JWT guard protects this route (project API keys are not accepted).
@Controller("organizations/:organizationId/projects/:projectId/assistant")
export class AssistantController {
	constructor(private readonly assistant: AssistantService) { }

	// Validates the request, then lets the service write JSON errors or the SSE stream.
	@Post()
	async ask(
		@UuidParam("organizationId") organizationId: string,
		@UuidParam("projectId") projectId: string,
		@Req() request: AuthenticatedRequest,
		@Res() response: Response,
	): Promise<void> {
		assertBodySize(request);
		const body = parseAskAssistantBody(request.body);

		await this.assistant.ask(
			{
				requestId: request.requestId,
				userId: request.user.id,
				organizationId,
				projectId,
				tokenExpiresAt: request.accessTokenExpiresAt,
				question: body.question,
				query: body.query,
			},
			response,
		);
	}
}
