/**
 * + Builds the context (transaction, allowlist, 32 KiB, no-data), 
 * + then orchestrates the stream:
 *  - limits
 *  - slot
 *  - deadlines
 *  - re-checks, 
 *  - single finish()
 */

// @Injectable(): lets Nest create this class and inject it where it is needed.
import { HttpStatus, Injectable } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Response } from "express";
import { ApiException } from "../common/errors/api.exception";
import type { AuthenticatedRequest } from "../common/types/authenticated-request";
import type { AskAssistantDto } from "./dto/ask-assistant.dto";

/**
 * Parameter object:
 * the controller passes one object bundling 
 * everything the service needs.
 */
export interface AskAssistantCommand {
	organizationId: string;
	projectId: string;
	body: AskAssistantDto;
	req: RawBodyRequest<AuthenticatedRequest>;
	res: Response;
}

/**
 * Objective: orchestrate one assistant answer.
 * Phase 2: validation is complete; the pipeline is not implemented yet.
 * Phases 4–6 replace ask() with context building, streaming and lifecycle.
 */
@Injectable()
export class AssistantService {
	async ask(_command: AskAssistantCommand): Promise<void> {
		throw new ApiException(HttpStatus.NOT_IMPLEMENTED, "NOT_IMPLEMENTED", "The assistant is not available yet."); // TEMPORARY
	}
}