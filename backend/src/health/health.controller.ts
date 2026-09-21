import { Controller, Get } from "@nestjs/common"
import { HealthService } from "./health.service"
import { Public } from "../common/decorators/public.decorator";

@Controller("health")
export class HealthController {
	constructor(
		private readonly healthService: HealthService
	) {}

	@Public()
	@Get()
	getHealth() {
		return this.healthService.getHealth();
	}

	@Public()
	@Get("db")
	async checkDatabase() {
		return this.healthService.checkDatabase();
	}
}
