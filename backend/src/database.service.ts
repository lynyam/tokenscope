import { Pool } from "pg"
import { Injectable } from "@nestjs/common"

function requireEnv(name: string): string {
	const value = process.env[name];
	if (value === undefined || value === "") {
		throw new Error(`Missing required environment : ${name}`);
	}
	return value;
}

function requirePort(name: string): number {
	const value = Number(requireEnv(name));
	if (!Number.isInteger(value) || Number.isNaN(value)
		|| value <= 0 || value > 65535) {
		throw new Error(`Invalid port number for environment : ${name}`);
	}
	return value;
}

const config = {
	database: requireEnv("DB_NAME"),
	host: requireEnv("DB_HOST"),
	user: requireEnv("DB_USER"),
	password: requireEnv("DB_PASSWORD"),
	port: Number(requirePort("DB_PORT")),
	max: 10,
}

@Injectable()
export class DatabaseService {
	private readonly pool = new Pool(config);

	async check() {
		const result = await this.pool.query('SELECT 1 AS OKAy');
		return result.rows;
	}
}
