import "reflect-metadata";
import { open } from "node:fs/promises";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigurationModule } from "../config/configuration.module";
import { DatabaseModule } from "../database/database.module";
import { PricingService } from "../pricing/pricing.service";
import { MAX_CATALOGUE_BYTES } from "../pricing/price-catalogue";
import { ApiException } from "../common/errors/api.exception";

@Module({
	imports: [ConfigurationModule, DatabaseModule],
	providers: [PricingService],
})
class PriceLoaderModule { }

async function readCatalogue(path: string): Promise<unknown> {
	const file = await open(path, "r");

	try {
		if (!(await file.stat()).isFile()) {
			throw new Error("Catalogue input must be a regular file.");
		}

		// Read at most the limit plus one byte, including if the file changes.
		const buffer = Buffer.alloc(MAX_CATALOGUE_BYTES + 1);
		let bytes = 0;

		while (bytes < buffer.length) {
			const result = await file.read(
				buffer,
				bytes,
				buffer.length - bytes,
				null,
			);

			if (result.bytesRead === 0) break;
			bytes += result.bytesRead;
		}

		if (bytes > MAX_CATALOGUE_BYTES) {
			throw new Error("Catalogue file must not exceed 1 MiB.");
		}

		try {
			const text = new TextDecoder("utf-8", { fatal: true })
				.decode(buffer.subarray(0, bytes));

			return JSON.parse(text);
		} catch {
			throw new Error("Catalogue file must contain valid UTF-8 JSON.");
		}
	} finally {
		await file.close();
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (
		args.length !== 2 ||
		args[0] !== "--file" ||
		args[1].trim() === ""
	) {
		throw new Error(
			"Usage: npm run pricing:load -- --file <catalogue.json>",
		);
	}

	const input = await readCatalogue(args[1]);

	const app = await NestFactory.createApplicationContext(
		PriceLoaderModule,
		{ logger: false, abortOnError: false },
	);

	try {
		const result = await app.get(PricingService).loadCatalogue(input);
		console.log(JSON.stringify(result));
	} finally {
		await app.close();
	}
}

main().catch(error => {
	if (error instanceof ApiException) {
		console.error(`${error.code}: ${error.publicMessage}`);
	} else {
		// Do not print raw database exceptions or environment values.
		console.error(
			"Catalogue loading failed. Check the file, arguments, database and application environment.",
		);
	}

	process.exitCode = 1;
});
