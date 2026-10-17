import {
	CallHandler,
	ExecutionContext,
	HttpStatus,
	Injectable,
	InternalServerErrorException,
	NestInterceptor,
	type RawBodyRequest,
} from "@nestjs/common";
import type { Request } from "express";
import { ApiException } from "../common/errors/api.exception";

@Injectable()
export class TraceBodyInterceptor implements NestInterceptor {
	intercept(context: ExecutionContext, next: CallHandler) {
		const request = context.switchToHttp()
			.getRequest<RawBodyRequest<Request>>();

		if (!request.is("application/json")) {
			throw new ApiException(
				HttpStatus.UNSUPPORTED_MEDIA_TYPE,
				"UNSUPPORTED_MEDIA_TYPE",
				"Use Content-Type: application/json.",
			);
		}

		if (!Buffer.isBuffer(request.rawBody)) {
			// An empty body is a client error. A parsed nonempty body without
			// raw bytes indicates incorrect application initialization.
			if (
				request.body === undefined ||
				request.headers["content-length"] === "0"
			) {
				throw new ApiException(
					HttpStatus.BAD_REQUEST,
					"VALIDATION_ERROR",
					"A JSON request body is required.",
				);
			}

			throw new InternalServerErrorException();
		}

		if (request.rawBody.length > 16_384) {
			throw new ApiException(
				HttpStatus.PAYLOAD_TOO_LARGE,
				"PAYLOAD_TOO_LARGE",
				"The JSON body must not exceed 16384 bytes.",
			);
		}

		return next.handle();
	}
}
