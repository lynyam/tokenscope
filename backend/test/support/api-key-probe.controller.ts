import {
	Body,
	Controller,
	Get,
	Post,
} from "@nestjs/common";
import { IsString } from "class-validator";
import { PublicApi } from "../../src/api-keys/public-api.decorator";
import { CurrentApiKey } from "../../src/api-keys/current-api-key.decorator";
import type { ApiKeyPrincipal } from "../../src/api-keys/api-key.types";

class ProbeDto {
	@IsString()
	value!: string;
}

// Registered only by test modules. Never import this from src/.
@Controller("__test/api-key")
@PublicApi()
export class ApiKeyProbeController {
	@Get()
	read(@CurrentApiKey() principal: ApiKeyPrincipal) {
		return principal;
	}

	@Post()
	write(
		@CurrentApiKey() principal: ApiKeyPrincipal,
		@Body() _dto: ProbeDto,
	) {
		return principal;
	}
}
