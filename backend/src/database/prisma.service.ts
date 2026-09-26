import { Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import type { EnvironmentVariables } from "../config/env.validation";
import { PrismaClient } from "../generated/prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
	constructor(config: ConfigService<EnvironmentVariables>) {
		const adapter = new PrismaPg({
			connectionString: config.getOrThrow("DATABASE_URL", {infer: true}),
			max: 10,
			connectionTimeoutMillis: 5000,
		});

		super({
			adapter,
			log: [],
		});
	}

	async onModuleInit(): Promise<void> {
		await this.$connect();
	}

	async onApplicationShutdown(): Promise<void> {
		await this.$disconnect();
	}
}
