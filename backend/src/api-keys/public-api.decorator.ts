import {
	applyDecorators,
	UseGuards,
} from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { ApiKeyGuard } from "./api-key.guard";

// Bypass user JWT authentication while explicitly applying API-key
// authentication and both public quotas.
export function PublicApi() {
	return applyDecorators(
		Public(),
		UseGuards(ApiKeyGuard),
	);
}
