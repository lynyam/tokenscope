import { Catch, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { STATUS_CODES } from "node:http";
import { isHttpError } from "http-errors";
import type { Response } from "express";

import { ApiException } from "../errors/api.exception";
import { REQUEST_ID_HEADER } from "../constants/http.constants"
import type { ApiErrorResponse } from "../types/api-error";
import type { RequestWithRequestId } from "../types/request-with-request-id";

type PublicError = Pick<ApiErrorResponse, "code" | "message">;

const DEFAULT_ERRORS: Partial<Record<number, PublicError>> = {
	400: {
		code: "VALIDATION_ERROR",
		message: "Request validation failed.",
	},
	401: {
		code: "AUTHENTICATION_REQUIRED",
		message: "Authentication is required.",
	},
	403: {
		code: "FORBIDDEN",
		message: "You are not allowed to perform this action.",
	},
	404: {
		code: "NOT_FOUND",
		message: "The requested resource was not found.",
	},
	409: {
		code: "CONFLICT",
		message: "The request conflicts with the current resource state.",
	},
	413: {
		code: "PAYLOAD_TOO_LARGE",
		message: "The request body is too large.",
	},
	415: {
		code: "UNSUPPORTED_MEDIA_TYPE",
		message: "The request content type or encoding is unsupported.",
	},
	500: {
		code: "INTERNAL_SERVER_ERROR",
		message: "An unexpected error occurred.",
	},
	503: {
		code: "SERVICE_UNAVAILABLE",
		message: "A required service is unavailable.",
	},
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
	private readonly logger = new Logger(ApiExceptionFilter.name);

	catch(exception: unknown, host: ArgumentsHost): void {
		const context = host.switchToHttp();
		const request = context.getRequest<RequestWithRequestId>();
		const response = context.getResponse<Response>();

		const requestedStatus = exception instanceof HttpException ?
			exception.getStatus() : isHttpError(exception) ? exception.statusCode
				: HttpStatus.INTERNAL_SERVER_ERROR;

		const statusCode = Number.isInteger(requestedStatus) &&
			requestedStatus >= 400 && requestedStatus <= 599 ? requestedStatus : HttpStatus.INTERNAL_SERVER_ERROR;

		const defaults = DEFAULT_ERRORS[statusCode] ?? {
			code: statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "HTTP_ERROR",
			message: statusCode >= 500 ? "An unexpected error occurred." : "The request could not be processed.",
		};

		const isPublicError = exception instanceof ApiException && statusCode !== HttpStatus.INTERNAL_SERVER_ERROR;

		const requestId = request.requestId ?? randomUUID();
		request.requestId = requestId;

		const body: ApiErrorResponse = {
			statusCode,
			code: isPublicError ? exception.code : defaults.code,
			error: STATUS_CODES[statusCode] ?? "Error",
			message: isPublicError ? exception.publicMessage : defaults.message,
			requestId,
		};

		if (isPublicError && exception.details !== undefined) {
			body.details = exception.details.map(({ field, messages }) => ({
				field,
				messages: [...messages],
			}));
		}

		const route: unknown = request.route?.path;
		const log = JSON.stringify({
			event: "request_failed",
			requestId,
			method: request.method,
			route: typeof route === "string" ? route : "<unmatched>",
			statusCode,
			code: body.code,
		});

		if (statusCode >= 500) {
			this.logger.error(log);
		} else {
			this.logger.warn(log);
		}

		if (response.headersSent) {
			response.end();
			return;
		}

		response.setHeader(REQUEST_ID_HEADER, requestId);
		response.status(statusCode).json(body);
	}
}
