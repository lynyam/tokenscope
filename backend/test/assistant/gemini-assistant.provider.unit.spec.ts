import "reflect-metadata";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ApiError } from "@google/genai";

import { ASSISTANT_INSTRUCTIONS } from "../../src/assistant/assistant-prompt";
import type { AssistantContext, ProviderEvent } from "../../src/assistant/assistant.types";
import { GeminiAssistantProvider } from "../../src/assistant/gemini-assistant.provider";

// Replace only the client class. ApiError and the types stay real.
const mockGenerate = jest.fn();
const mockClientOptions: unknown[] = [];

jest.mock("@google/genai", () => {
	const actual = jest.requireActual("@google/genai");
	return {
		...actual,
		GoogleGenAI: jest.fn().mockImplementation((options: unknown) => {
			mockClientOptions.push(options);
			return { models: { generateContentStream: mockGenerate } };
		}),
	};
});

const dir = existsSync("/fixtures/evaluation")
	? "/fixtures/evaluation"
	: resolve(process.cwd(), "../fixtures/evaluation");
const CONTEXT: AssistantContext = JSON.parse(readFileSync(resolve(dir, "assistant/context.json"), "utf8"));

// Builds a provider with fake settings.
function makeProvider(settings: Record<string, string | undefined> = { GEMINI_API_KEY: "test-key", LLM_MODEL: "gemini-test" }) {
	return new GeminiAssistantProvider({ get: (key: string) => settings[key] } as never);
}

// A fake Gemini stream made of chunks.
async function* chunks(...items: unknown[]) {
	for (const item of items) yield item;
}

// A fake Gemini chunk.
function chunk(text: string | null, finishReason?: string, extra: Record<string, unknown> = {}) {
	return {
		candidates: [{ content: { parts: text === null ? [] : [{ text }] }, ...(finishReason ? { finishReason } : {}) }],
		...extra,
	};
}

// Collects every event of one answer.
async function collect(provider: GeminiAssistantProvider, signal = new AbortController().signal): Promise<ProviderEvent[]> {
	const events: ProviderEvent[] = [];
	for await (const event of provider.stream("Which model costs most?", CONTEXT, signal)) {
		events.push(event);
	}
	return events;
}

describe("GeminiAssistantProvider", () => {
	beforeEach(() => {
		mockGenerate.mockReset();
		mockClientOptions.length = 0;
	});

	it("is not configured without a key or a model, and never builds a client", async () => {
		for (const settings of [{ LLM_MODEL: "gemini-test" }, { GEMINI_API_KEY: "test-key" }, {}]) {
			const provider = makeProvider(settings);
			expect(provider.isConfigured()).toBe(false);
			expect(await collect(provider)).toEqual([{ type: "failure", kind: "unavailable" }]);
		}
		expect(mockClientOptions).toHaveLength(0);
		expect(mockGenerate).not.toHaveBeenCalled();
	});

	it("creates the client with one single attempt (no automatic retry)", () => {
		makeProvider();
		expect(mockClientOptions).toEqual([{ apiKey: "test-key", httpOptions: { retryOptions: { attempts: 1 } } }]);
	});

	it("sends one candidate, 600 output tokens, fixed instructions and the abort signal; no tools", async () => {
		mockGenerate.mockResolvedValue(chunks(chunk("Hi", "STOP")));
		const signal = new AbortController().signal;
		await collect(makeProvider(), signal);

		expect(mockGenerate).toHaveBeenCalledTimes(1);
		const params = mockGenerate.mock.calls[0][0];
		expect(params.model).toBe("gemini-test");
		expect(params.config).toEqual({
			systemInstruction: ASSISTANT_INSTRUCTIONS,
			candidateCount: 1,
			maxOutputTokens: 600,
			abortSignal: signal,
			automaticContinuation: false,
		});
		expect(params.config.tools).toBeUndefined();
		expect(params.contents).toContain("<question>");
		expect(params.contents).not.toContain(CONTEXT.project.id);
	});

	it("turns visible text into deltas and STOP into done/stop with usage", async () => {
		mockGenerate.mockResolvedValue(chunks(
			chunk("fixture-b/demo-large "),
			{ candidates: [{ content: { parts: [{ text: "secret reasoning", thought: true }, { text: "costs most." }] } }] },
			chunk(null, "STOP", { usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 8 } }),
		));

		expect(await collect(makeProvider())).toEqual([
			{ type: "open" },
			{ type: "delta", text: "fixture-b/demo-large " },
			{ type: "delta", text: "costs most." },
			{ type: "done", finishReason: "stop", usage: { inputTokens: 120, outputTokens: 8 } },
		]);
	});

	it("reports usage as null when Gemini does not send it", async () => {
		mockGenerate.mockResolvedValue(chunks(chunk("Hi", "STOP")));
		expect((await collect(makeProvider())).at(-1)).toEqual({ type: "done", finishReason: "stop", usage: null });
	});

	it("turns MAX_TOKENS into done/length", async () => {
		mockGenerate.mockResolvedValue(chunks(chunk("Long", "MAX_TOKENS")));
		expect((await collect(makeProvider())).at(-1)).toEqual({ type: "done", finishReason: "length", usage: null });
	});

	it.each(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "RECITATION"])("turns %s into a refusal", async reason => {
		mockGenerate.mockResolvedValue(chunks(chunk(null, reason)));
		expect(await collect(makeProvider())).toEqual([{ type: "open" }, { type: "failure", kind: "refused" }]);
	});

	it("turns a blocked prompt into a refusal", async () => {
		mockGenerate.mockResolvedValue(chunks({ promptFeedback: { blockReason: "SAFETY" } }));
		expect(await collect(makeProvider())).toEqual([{ type: "open" }, { type: "failure", kind: "refused" }]);
	});

	it("never reports success when the stream ends without a finish reason", async () => {
		mockGenerate.mockResolvedValue(chunks(chunk("Half")));
		expect((await collect(makeProvider())).at(-1)).toEqual({ type: "failure", kind: "provider_error" });
	});

	it("treats malformed chunks and unexpected finish reasons as provider errors", async () => {
		mockGenerate.mockResolvedValue(chunks({}, chunk(null, "OTHER")));
		expect(await collect(makeProvider())).toEqual([{ type: "open" }, { type: "failure", kind: "provider_error" }]);
	});

	it.each([
		[400, "unavailable"],
		[401, "unavailable"],
		[403, "unavailable"],
		[404, "unavailable"],
		[429, "busy"],
		[503, "busy"],
		[500, "provider_error"],
	])("maps an SDK error with HTTP %s to %s (never a TokenScope 401)", async (status, kind) => {
		mockGenerate.mockRejectedValue(new ApiError({ message: "raw provider detail", status }));
		expect(await collect(makeProvider())).toEqual([{ type: "failure", kind }]);
	});

	it("maps a failure in the middle of the stream to a provider error", async () => {
		mockGenerate.mockResolvedValue((async function* () {
			yield chunk("Start");
			throw new Error("connection reset");
		})());
		expect(await collect(makeProvider())).toEqual([
			{ type: "open" },
			{ type: "delta", text: "Start" },
			{ type: "failure", kind: "provider_error" },
		]);
	});
	it("does not forward text from a refused chunk or consume later chunks", async () => {
		mockGenerate.mockResolvedValue(chunks(chunk("blocked text", "SAFETY"), chunk("later", "STOP")));
		expect(await collect(makeProvider())).toEqual([{ type: "open" }, { type: "failure", kind: "refused" }]);
	});

	it("rejects malformed text rather than silently completing with partial content", async () => {
		mockGenerate.mockResolvedValue(chunks(
			chunk("first"),
			{ candidates: [{ content: { parts: [{ text: 42 }] }, finishReason: "STOP" }] },
		));
		expect((await collect(makeProvider())).at(-1)).toEqual({ type: "failure", kind: "provider_error" });
	});

	it.each([-1, 1.5, NaN, Infinity])("does not expose invalid usage %s", async value => {
		mockGenerate.mockResolvedValue(chunks(chunk("ok", "STOP", {
			usageMetadata: { promptTokenCount: 10, candidatesTokenCount: value },
		})));
		expect((await collect(makeProvider())).at(-1)).toMatchObject({ type: "done", usage: null });
	});

});
