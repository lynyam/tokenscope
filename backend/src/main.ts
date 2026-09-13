import { AppModule } from "./app.module"
import { NestFactory } from "@nestjs/core"
import type { EnvironmentVariables } from "./config/env.validation";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { configureApp } from "./configure-app";

async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	configureApp(app);
	app.enableShutdownHooks();

	const config = app.get<ConfigService<EnvironmentVariables>>(ConfigService);
	const port = config.getOrThrow("BACKEND_PORT", {infer : true});
	await app.listen(port);
	new Logger("Bootstrap").log(`Server is listening on port ${port}`);
}

void bootstrap();
