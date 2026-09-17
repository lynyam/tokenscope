import { Controller, Get, UseGuards } from "@nestjs/common"
import { HealthService } from "./health.service"
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard"
import { CurrentUser } from "../common/decorators/current-user.decorator"
import { AuthenticatedUser } from "../common/types/authenticated-user"

@Controller("health")
export class HealthController {
	constructor(
		private readonly healthService: HealthService
	) {}

	@Get()
	getHealth() {
		return this.healthService.getHealth();
	}

	@Get("db")
	async checkDatabase() {
		return this.healthService.checkDatabase();
	}
	@Get("whoami")
	@UseGuards(JwtAuthGuard)
	whoAmI(@CurrentUser() user: AuthenticatedUser) {
		return { userId: user.userId };
	}
}
