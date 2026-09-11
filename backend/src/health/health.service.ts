import { HttpStatus, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ApiException } from "../common/errors/api.exception";

@Injectable()
export class HealthService {
	constructor(private readonly prisma: PrismaService) {}

	getHealth() {
		return { status: "healthy" };
	}

	async checkDatabase() {
		try {
			await this.prisma.$queryRaw`SELECT 1`;
		} catch {
			throw new ApiException(
				HttpStatus.SERVICE_UNAVAILABLE,
				"DATABASE_UNAVAILABLE",
				"Database is unavailable.",
			);
		}
		return this.getHealth();
	}
}
