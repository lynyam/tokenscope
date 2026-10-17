import {
	CanActivate,
	ExecutionContext,
	HttpStatus,
	Injectable,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiException } from "../common/errors/api.exception";
import { ClientIpService } from "../common/rate-limit/client-ip.service";
import { RateLimitService } from "../common/rate-limit/rate-limit.service";
import { ApiKeyAuthService } from "./api-key-auth.service";
import type { ApiKeyRequest } from "./api-key.types";

@Injectable()
export class ApiKeyGuard implements CanActivate {
	constructor(
		private readonly auth: ApiKeyAuthService,
		private readonly limits: RateLimitService,
		private readonly clientIps: ClientIpService,
	) { }

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const http = context.switchToHttp();
		const request = http.getRequest<ApiKeyRequest>();
		const response = http.getResponse<Response>();

		const clientIp = await this.clientIps.getClientIp(request);

		// Missing and invalid credentials still consume the IP budget.
		this.consume(response, "public-traces:ip", clientIp, 60);

		const key = this.readSingleKey(request);
		const principal = await this.auth.authenticate(key);

		// All public trace methods share this verified-key namespace.
		this.consume(
			response,
			"public-traces:key",
			principal.keyId,
			120,
		);

		request.apiKey = principal;

		// Await the best-effort method; no unhandled background rejection.
		await this.auth.recordSuccessfulUse(principal);

		return true;
	}

	private readSingleKey(request: ApiKeyRequest): string {
		let occurrences = 0;

		for (let i = 0; i < request.rawHeaders.length; i += 2) {
			if (request.rawHeaders[i].toLowerCase() === "x-api-key") {
				occurrences += 1;
			}
		}

		const value = request.headers["x-api-key"];

		if (occurrences !== 1 || typeof value !== "string") {
			throw new ApiException(
				HttpStatus.UNAUTHORIZED,
				"INVALID_API_KEY",
				"The provided API key is invalid.",
			);
		}

		// Format validation rejects combined values and whitespace.
		return value;
	}

	private consume(
		response: Response,
		namespace: string,
		identity: string,
		limit: number,
	): void {
		const decision = this.limits.consume(
			namespace,
			identity,
			limit,
		);

		if (decision.allowed === false) {
			response.setHeader(
				"Retry-After",
				String(decision.retryAfterSeconds),
			);

			throw new ApiException(
				HttpStatus.TOO_MANY_REQUESTS,
				"RATE_LIMITED",
				"Too many requests. Please try again later.",
			);
		}
	}
}
