import { Controller, Get, UseGuards } from "@nestjs/common"
import { DatabaseService } from "./database.service"
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard"
import { CurrentUser } from "./common/decorators/current-user.decorator"
import { AuthenticatedUser } from "./common/types/authenticated-user"


@Controller("health")
export class HealthController {
	constructor(
		private readonly databaseService: DatabaseService
	) {}

	@Get()
	getHealth() {
		return { "status" : "healthy!" };
	}
	@Get("db") ///health/db
	async checkDatabase() {
		return this.databaseService.check();
	}
	@Get("whoami")
    @UseGuards(JwtAuthGuard)
    whoAmI(@CurrentUser() user: AuthenticatedUser) {
        return { userId: user.userId };
	}
}
