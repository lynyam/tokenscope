import {
	createParamDecorator,
	ExecutionContext,
	InternalServerErrorException,
} from "@nestjs/common";
import type {
	ApiKeyPrincipal,
	ApiKeyRequest,
} from "./api-key.types";

export const CurrentApiKey = createParamDecorator(
	(
		_data: unknown,
		context: ExecutionContext,
	): ApiKeyPrincipal => {
		const request = context
			.switchToHttp()
			.getRequest<ApiKeyRequest>();

		if (!request.apiKey) {
			// This indicates incorrect controller wiring.
			throw new InternalServerErrorException();
		}

		return request.apiKey;
	},
);
