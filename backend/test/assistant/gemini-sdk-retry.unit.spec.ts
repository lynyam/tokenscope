import "reflect-metadata";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { AssistantContext, ProviderEvent } from "../../src/assistant/assistant.types";
import { GeminiAssistantProvider } from "../../src/assistant/gemini-assistant.provider";

// Uses the REAL installed @google/genai SDK. fetch is replaced: nothing reaches Google.

const dir = existsSync("/fixtures/evaluation")
	? "/fixtures/evaluation"
	: resolve(process.cwd(), "../fixtures/evaluation");
const CONTEXT: AssistantContext = JSON.parse(readFileSync(resolve(dir, "assistant/context.json"), "utf8"));

describe("Installed Gemini SDK", () => {
	afterEach(() => jest.restoreAllMocks());

	it("makes exactly one HTTP attempt on a retryable 429", async () => {
		const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(async () =>
			new Response(
				JSON.stringify({ error: { code: 429, message: "quota", status: "RESOURCE_EXHAUSTED" } }),
				{ status: 429, headers: { "content-type": "application/json" } },
			),
		);

		const provider = new GeminiAssistantProvider({
			get: (key: string) => ({ GEMINI_API_KEY: "test-only-key", LLM_MODEL: "gemini-test" } as Record<string, string>)[key],
		} as never);

		const events: ProviderEvent[] = [];
		for await (const event of provider.stream("Question?", CONTEXT, new AbortController().signal)) {
			events.push(event);
		}

		expect(events).toEqual([{ type: "failure", kind: "busy" }]);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});
