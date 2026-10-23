import { HttpStatus } from "@nestjs/common";

import { parseAnalyticsQuery } from "../../analytics/dto/analytics-query.dto";
import type { ResolvedAnalyticsQuery } from "../../analytics/analytics.types";
import { ApiException } from "../../common/errors/api.exception";
import type { AuthenticatedRequest } from "../../common/types/authenticated-request";
import {
	assertDatabaseText,
	invalidUsage,
	plainObject,
	rejectUnknownFields,
} from "../../common/validation/usage-values";
import { ASSISTANT_ERRORS, toApiException } from "../assistant-errors";

export const MAX_BODY_BYTES = 8192;
const MAX_QUESTION_LENGTH = 2000;
const BODY_FIELDS = ["question", "from", "to", "filters"];
const FILTER_FIELDS = ["q", "provider", "model", "workflow", "status"];

export interface AskAssistantBody {
	question: string;
	query: ResolvedAnalyticsQuery;
}

// Checks the REAL body size in bytes (not characters, not Content-Length).
export function assertBodySize(request: AuthenticatedRequest): void {
	if (!request.is("application/json")) {
		throw new ApiException(
			HttpStatus.UNSUPPORTED_MEDIA_TYPE,
			"UNSUPPORTED_MEDIA_TYPE",
			"Use Content-Type: application/json.",
		);
	}

	if (!Buffer.isBuffer(request.rawBody) || request.rawBody.length === 0) {
		invalidUsage("body", "A JSON request body is required.");
	}

	if (request.rawBody.length > MAX_BODY_BYTES) {
		throw toApiException(ASSISTANT_ERRORS.payloadTooLarge);
	}
}

// Validates the body and resolves dates + filters with the shared analytics rules.
export function parseAskAssistantBody(input: unknown, now = new Date()): AskAssistantBody {
	const body = plainObject(input, "body");
	rejectUnknownFields(body, BODY_FIELDS); // rejects traceId, summary, project...

	// question: required, trimmed, 1-2000 characters
	if (typeof body.question !== "string") {
		invalidUsage("question", "Must be a string.");
	}
	assertDatabaseText(body.question, "question");
	const question = body.question.trim();
	const length = [...question].length;
	if (length < 1 || length > MAX_QUESTION_LENGTH) {
		invalidUsage("question", `Must contain 1 to ${MAX_QUESTION_LENGTH} characters.`);
	}

	// from / to: required
	if (body.from === undefined) invalidUsage("from", "Required.");
	if (body.to === undefined) invalidUsage("to", "Required.");

	// filters: required object, only the five known filters
	if (body.filters === undefined) invalidUsage("filters", "Required. Use {} for no filters.");
	const filters = plainObject(body.filters, "filters");
	rejectUnknownFields(filters, FILTER_FIELDS);

	// Same parser as the dashboard analytics: same filters, same bucket choice.
	const query = parseAnalyticsQuery({ ...filters, from: body.from, to: body.to }, now, true);

	return { question, query };
}
