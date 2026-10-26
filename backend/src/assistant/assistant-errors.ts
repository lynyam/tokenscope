import { ApiException } from "../common/errors/api.exception";
import type { ProviderFailureKind } from "./assistant.types";

// One safe error: HTTP status, public code, public message, retry hint.
export interface AssistantError {
	status: number;
	code: string;
	message: string;
	retryable: boolean;
}

// The ONLY list of assistant errors. Messages never contain raw provider text.
export const ASSISTANT_ERRORS = {
	payloadTooLarge: { status: 413, code: "PAYLOAD_TOO_LARGE", message: "The JSON body must not exceed 8192 bytes.", retryable: false },
	projectNotFound: { status: 404, code: "PROJECT_NOT_FOUND", message: "Project not found.", retryable: false },
	noData: { status: 422, code: "ASSISTANT_NO_DATA", message: "No traces match this period and these filters.", retryable: false },
	contextTooLarge: { status: 422, code: "ASSISTANT_CONTEXT_TOO_LARGE", message: "The selected analytics are too large. Narrow the period or the filters.", retryable: false },
	refused: { status: 422, code: "LLM_REFUSED", message: "The provider could not answer this question.", retryable: false },
	alreadyRunning: { status: 429, code: "ASSISTANT_ALREADY_RUNNING", message: "You already have an assistant answer in progress.", retryable: true },
	rateLimited: { status: 429, code: "RATE_LIMITED", message: "Too many assistant requests. Try again later.", retryable: true },
	unavailable: { status: 503, code: "LLM_UNAVAILABLE", message: "The assistant is not available.", retryable: false },
	busy: { status: 503, code: "LLM_PROVIDER_BUSY", message: "The assistant provider is busy. Try again later.", retryable: true },
	providerError: { status: 502, code: "LLM_PROVIDER_ERROR", message: "The assistant provider failed.", retryable: true },
	timeout: { status: 504, code: "LLM_TIMEOUT", message: "The assistant timed out.", retryable: true },
	tokenExpired: { status: 401, code: "ACCESS_TOKEN_EXPIRED", message: "Your session has expired.", retryable: false },
	shuttingDown: { status: 503, code: "SERVICE_UNAVAILABLE", message: "The server is restarting. Try again later.", retryable: true },
	internal: { status: 500, code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred.", retryable: true },
} satisfies Record<string, AssistantError>;

// Provider failure kind -> public error.
export const PROVIDER_FAILURE_ERRORS: Record<ProviderFailureKind, AssistantError> = {
	refused: ASSISTANT_ERRORS.refused,
	unavailable: ASSISTANT_ERRORS.unavailable,
	busy: ASSISTANT_ERRORS.busy,
	provider_error: ASSISTANT_ERRORS.providerError,
};

// Turns an assistant error into the normal JSON error (before the stream starts).
export function toApiException(error: AssistantError): ApiException {
	return new ApiException(error.status, error.code, error.message);
}
