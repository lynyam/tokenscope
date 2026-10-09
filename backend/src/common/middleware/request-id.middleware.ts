import type { RequestWithRequestId } from "../types/request-with-request-id";
import type { NextFunction, Response } from "express";
import { randomUUID } from "crypto";
import { REQUEST_ID_HEADER } from "../constants/http.constants";

export function requestIdMiddleware(req: RequestWithRequestId, res: Response, next: NextFunction) {
	const supplied = req.headers["x-request-id"];

	const isValid = typeof supplied === "string" &&
		supplied.length > 0 && supplied.length <= 128 &&
		!/[^A-Za-z0-9._:-]/u.test(supplied);

	const requestId = isValid ? supplied : randomUUID();
	req.requestId = requestId;
	res.setHeader(REQUEST_ID_HEADER, requestId);
	next();
}
