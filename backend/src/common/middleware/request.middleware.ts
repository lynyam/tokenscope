import { Logger } from "@nestjs/common";
import { performance } from "node:perf_hooks";
import type { NextFunction, Response } from "express";
import { requestLogContext } from "../logging/request-log-context";
import type { RequestWithRequestId } from "../types/request-with-request-id";

const logger = new Logger("HttpRequest");

export function requestLoggingMiddleware(
	request: RequestWithRequestId,
	response: Response,
	next: NextFunction,
): void {
	const startedAt = performance.now();

	response.once("finish", () => {
		logger.log(
			JSON.stringify({
				event: "request_completed",
        		...requestLogContext(request),
				statusCode: response.statusCode,
				durationMs:
					Math.round((performance.now() - startedAt) * 100) / 100,
			}),
		);
	});
	next();
}
