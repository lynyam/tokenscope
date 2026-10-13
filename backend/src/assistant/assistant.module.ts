import { Module } from "@nestjs/common";
//read validated configuration to get Gemini API key and model
import { ConfigService } from "@nestjs/config";
//added for typescript checking
import type { EnvironmentVariables } from "../config/env.validation";
import { AssistantController } from "./assistant.controller";
//label with which the LLM provider is registered.
import { ASSISTANT_PROVIDER } from "./assistant.provider";
import { AssistantService } from "./assistant.service";
// the class to build the real Gemini implememtation
import { GeminiAssistantProvider } from "./gemini-assistant.provider";

@Module({
	controllers: [AssistantController],
	providers: [
		AssistantService,
		{

			provide: ASSISTANT_PROVIDER,
			inject: [ConfigService], 
			useFactory: (config: ConfigService<EnvironmentVariables>) =>
				new GeminiAssistantProvider({
					apiKey: config.get("GEMINI_API_KEY", { infer: true }) ?? null,
					model: config.get("LLM_MODEL", { infer: true }) ?? null,
				}),
		},
	],
})
export class AssistantModule {}