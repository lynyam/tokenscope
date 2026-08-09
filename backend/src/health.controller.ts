import { Controller, Get } from "@nestjs/common"
import { DatabaseService } from "./database.service"

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
}
