/**
 * POST .../assistant: 
 * + JWT guard
 * + UUID params
 * + DTO
 * + byte check
 * , then hands the raw response to the service
 */

import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
// RawBodyRequest<T>: a request type that also has `rawBody?: Buffer` (enabled in main.ts).
import type { RawBodyRequest } from "@nestjs/common";
import type { Response } from "express";
import { ApiException } from "../common/errors/api.exception";
import { UuidParam } from "../common/decorators/uuid-param.decorators";
import type { AuthenticatedRequest } from "../common/types/authenticated-request";
import { AssistantService } from "./assistant.service";
import { ASSISTANT_LIMITS } from "./assistant.types";
import { AskAssistantDto } from "./dto/ask-assistant.dto";

/**
 * Objective: HTTP entry point of the dashboard assistant.
 * Request order (TSE-80 §8.B):
 *   global JwtAuthGuard → global ValidationPipe (DTO) → byte limit here → service.
 * Sub functionalities:
 *  + No @UseGuards: JwtAuthGuard is global (APP_GUARD).
 *  + @Res(): the service writes the response itself (SSE from Phase 5).
 *    Errors thrown BEFORE anything is written still become the JSON envelope.
 */
@Controller("organizations/:organizationId/projects/:projectId/assistant") // route prefix
export class AssistantController {
	constructor(private readonly assistant: AssistantService) {}

	@Post() // handles POST on the controller's route
	@HttpCode(HttpStatus.OK) // default success status 200 (Nest's POST default is 201)
	async ask(
		@UuidParam("organizationId") organizationId: string, // must match :organizationId
		@UuidParam("projectId") projectId: string, // must match :projectId
		@Body() body: AskAssistantDto, // parsed + validated body
		@Req() req: RawBodyRequest<AuthenticatedRequest>, // full request (user, expiry, rawBody)
		@Res() res: Response, // manual response control
	): Promise<void> {
		assertBodyWithinLimit(req);
		await this.assistant.ask({ organizationId, projectId, body, req, res });
	}
}

/** Counts bytes actually received — never string length or Content-Length. */
function assertBodyWithinLimit(req: RawBodyRequest<AuthenticatedRequest>): void {
	// Buffer.length = number of BYTES (é = 2 bytes, ह = 3 bytes, spaces count too).
	const size = req.rawBody?.length;

	if (size === undefined) {
		// rawBody must exist (main.ts rawBody: true). Fail closed rather than guess.
		throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_SERVER_ERROR", "An unexpected error occurred.");
	}
	if (size > ASSISTANT_LIMITS.bodyMaxBytes) {
		throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE", "The request body is too large.");
	}
}