/**
 * UNIT TESTS — GeminiAssistantProvider
 *
 * WHAT IS TESTED: the translator. Given what Google sends (chunks, errors),
 *   does the provider produce the right neutral events (delta / done / failure)?
 *
 * HOW: Google is replaced by a FAKE SDK CLIENT (see PART 3, fakeGoogle()).
 *   It replays hand-written chunks shaped like the Phase 0 spike output, or
 *   throws errors carrying an HTTP status. No network, no quota, deterministic.
 *
 * MAP — tests follow the provider's 4 steps:
 *
 *   stream(input, signal)
 *     SETUP  · client options ........... exactly one attempt (no hidden retries)
 *     STEP 1 · Am I ready? .............. no key/model → unavailable, no client
 *                                         already stopped → no SDK call
 *     STEP 2 · Open the call ............ request = model, rules, content, 600, 1, signal, no tools
 *                                         429/503 → busy · 400–404 → unavailable · else → provider_error
 *                                         stopped while waiting → no event
 *     STEP 3 · Relay .................... text → delta (untrimmed) · thoughts skipped
 *                                         prompt blocked → refused · dropped → provider_error
 *                                         stopped mid-answer → no further event
 *     STEP 4 · Report the ending ........ STOP → done/stop · MAX_TOKENS → done/length
 *                                         SAFETY… → refused · empty/no reason/unknown → provider_error
 *                                         usage = last reading (+ thinking tokens)
 *
 * FILE LAYOUT:
 *   PART 1  Test data   (top: used while Jest collects the tests)
 *   PART 2  Scenarios   (one describe per step)
 *   PART 3  Helpers     (function declarations, available everywhere)
 */

import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import type { ProviderEvent, ProviderInput } from "../../src/assistant/assistant.provider";
import {
	buildGeminiClientOptions,
	GeminiAssistantProvider,
	type GeminiStreamClient,
} from "../../src/assistant/gemini-assistant.provider";

// ════════════════════════════════════════════════════════════════════════
// PART 1 · TEST DATA
// ════════════════════════════════════════════════════════════════════════

/** The briefing the service would send (content is irrelevant to the translator). */
const INPUT: ProviderInput = {
	instructions: "Answer only from the DATA block.",
	content: "<DATA>{}</DATA><QUESTION>Which model costs most?</QUESTION>",
};

/** A configured provider: fake key, fake model name. */
const SETTINGS = { apiKey: "AIzaFakeKey123", model: "gemini-test-model" };

/** Final usage reading from the Phase 0 spike's normal run. */
const SPIKE_USAGE = { promptTokenCount: 165, candidatesTokenCount: 71 };

// ════════════════════════════════════════════════════════════════════════
// PART 2 · SCENARIOS (in the order of stream()'s steps)
// ════════════════════════════════════════════════════════════════════════

describe("SETUP · client options", () => {
	it("allows exactly one attempt — no hidden SDK retries", () => {
		expect(buildGeminiClientOptions("AIzaFakeKey123")).toEqual({
			apiKey: "AIzaFakeKey123",
			httpOptions: { retryOptions: { attempts: 1 } },
		});
	});
});

describe("STEP 1 · Am I ready?", () => {
	it.each([
		["the key is missing", { apiKey: null, model: "gemini-test-model" }],
		["the model is malformed", { apiKey: "AIzaFakeKey123", model: null }],
	])("answers 'unavailable' and never creates a client when %s", async (_label, settings) => {
		const createClient = jest.fn();
		const provider = new GeminiAssistantProvider(settings, createClient);

		expect(provider.isConfigured()).toBe(false);
		expect(await collectEvents(provider)).toEqual([{ type: "failure", kind: "unavailable" }]);
		expect(createClient).not.toHaveBeenCalled();
	});

	it("does not even call Google when the signal is already stopped", async () => {
		const stopped = stoppedSignal();
		const google = fakeGoogle({ chunks: [] });

		expect(await collectEvents(providerUsing(google.client), stopped)).toEqual([]);
		expect(google.requests).toHaveLength(0);
	});
});

describe("STEP 2 · Open the call", () => {
	it("sends one request: model, rules apart from content, 600 tokens, 1 answer, the signal, no tools", async () => {
		const google = fakeGoogle({ chunks: [geminiChunk({ text: "Hi", finishReason: "STOP" })] });
		const signal = new AbortController().signal;

		await collectEvents(providerUsing(google.client), signal);

		expect(google.requests).toHaveLength(1); // one request, no retry
		const request = google.requests[0];
		expect(request.model).toBe("gemini-test-model");
		expect(request.contents).toEqual([{ role: "user", parts: [{ text: INPUT.content }] }]);
		expect(request.config).toMatchObject({
			systemInstruction: INPUT.instructions,
			maxOutputTokens: 600,
			candidateCount: 1,
		});
		expect(request.config?.abortSignal).toBe(signal);
		expect(request.config).not.toHaveProperty("tools");
	});

	it.each([
		[429, "busy"], // quota exhausted
		[503, "busy"], // model overloaded
		[400, "unavailable"], // e.g. invalid key (seen in the spike)
		[401, "unavailable"],
		[403, "unavailable"],
		[404, "unavailable"], // unknown model (seen in the spike)
		[500, "provider_error"],
	])("maps a %i error at opening to '%s'", async (status, kind) => {
		const google = fakeGoogle({ throwAtOpening: providerError(status) });
		expect(await collectEvents(providerUsing(google.client))).toEqual([{ type: "failure", kind }]);
	});

	it("maps a network failure (no status) to 'provider_error'", async () => {
		const google = fakeGoogle({ throwAtOpening: new TypeError("fetch failed") });
		expect(await collectEvents(providerUsing(google.client))).toEqual([
			{ type: "failure", kind: "provider_error" },
		]);
	});

	it("emits nothing when stopped while waiting for Google — cancellation is not a failure", async () => {
		const controller = new AbortController();
		const client: GeminiStreamClient = {
			async generateContentStream() {
				controller.abort(); // the service presses Stop during the wait
				throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
			},
		};
		expect(await collectEvents(providerUsing(client), controller.signal)).toEqual([]);
	});
});

describe("STEP 3 · Relay what Gemini says", () => {
	it("relays each text piece as a delta, exactly as received (leading spaces kept)", async () => {
		const google = fakeGoogle({
			chunks: [
				geminiChunk({ text: "Based on" }),
				geminiChunk({ text: " the DATA, `demo-large`" }),
				geminiChunk({ finishReason: "STOP" }),
			],
		});
		const events = await collectEvents(providerUsing(google.client));
		expect(events.filter((e) => e.type === "delta")).toEqual([
			{ type: "delta", text: "Based on" },
			{ type: "delta", text: " the DATA, `demo-large`" },
		]);
	});

	it("never relays thought parts", async () => {
		const google = fakeGoogle({
			chunks: [geminiChunk({ thought: "internal reasoning", text: "Answer." }), geminiChunk({ finishReason: "STOP" })],
		});
		const deltas = (await collectEvents(providerUsing(google.client))).filter((e) => e.type === "delta");
		expect(deltas).toEqual([{ type: "delta", text: "Answer." }]);
	});

	it("reports a prompt blocked before any text as 'refused'", async () => {
		const google = fakeGoogle({ chunks: [geminiChunk({ blockReason: "SAFETY" })] });
		expect(await collectEvents(providerUsing(google.client))).toEqual([{ type: "failure", kind: "refused" }]);
	});

	it("reports a connection dropped mid-answer as 'provider_error', after the text already relayed", async () => {
		const google = fakeGoogle({
			chunks: [geminiChunk({ text: "Based on" }), geminiChunk({ text: " never arrives" })],
			throwAtChunk: { index: 1, error: new Error("socket hang up") },
		});
		expect(await collectEvents(providerUsing(google.client))).toEqual([
			{ type: "delta", text: "Based on" },
			{ type: "failure", kind: "provider_error" },
		]);
	});

	it("stops relaying when stopped mid-answer, with no ending event", async () => {
		const controller = new AbortController();
		const google = fakeGoogle({
			chunks: [geminiChunk({ text: "Based on" }), geminiChunk({ text: " more" }), geminiChunk({ finishReason: "STOP" })],
		});

		const events: ProviderEvent[] = [];
		for await (const event of providerUsing(google.client).stream(INPUT, controller.signal)) {
			events.push(event);
			controller.abort(); // Stop right after the first delta
		}
		expect(events).toEqual([{ type: "delta", text: "Based on" }]);
	});
});

describe("STEP 4 · Report how it ended", () => {
	it("STOP after text → done/stop with the LAST usage reading (spike case)", async () => {
		const google = fakeGoogle({
			chunks: [
				geminiChunk({ text: "Based on", usage: { promptTokenCount: 165, candidatesTokenCount: 2 } }),
				geminiChunk({ text: " the DATA", usage: { promptTokenCount: 165, candidatesTokenCount: 18 } }),
				geminiChunk({ finishReason: "STOP", usage: SPIKE_USAGE }),
			],
		});
		const events = await collectEvents(providerUsing(google.client));
		expect(events.at(-1)).toEqual({
			type: "done",
			finishReason: "stop",
			usage: { inputTokens: 165, outputTokens: 71 },
		});
	});

	it("MAX_TOKENS after text → done/length (truncated but successful)", async () => {
		const google = fakeGoogle({
			chunks: [geminiChunk({ text: "Based on the DATA, the model is `" }), geminiChunk({ finishReason: "MAX_TOKENS" })],
		});
		expect((await collectEvents(providerUsing(google.client))).at(-1)).toEqual({
			type: "done",
			finishReason: "length",
			usage: null,
		});
	});

	it("counts thinking tokens as output tokens", async () => {
		const google = fakeGoogle({
			chunks: [
				geminiChunk({ text: "Answer." }),
				geminiChunk({ finishReason: "STOP", usage: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 } }),
			],
		});
		expect((await collectEvents(providerUsing(google.client))).at(-1)).toEqual({
			type: "done",
			finishReason: "stop",
			usage: { inputTokens: 10, outputTokens: 12 },
		});
	});

	it.each(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"])(
		"%s after partial text → 'refused'",
		async (reason) => {
			const google = fakeGoogle({ chunks: [geminiChunk({ text: "Based on" }), geminiChunk({ finishReason: reason })] });
			expect(await collectEvents(providerUsing(google.client))).toEqual([
				{ type: "delta", text: "Based on" },
				{ type: "failure", kind: "refused" },
			]);
		},
	);

	it.each([
		["an empty STOP", [geminiChunk({ finishReason: "STOP" })]],
		["an empty MAX_TOKENS", [geminiChunk({ finishReason: "MAX_TOKENS" })]],
		["no finish reason at all", [geminiChunk({ text: "Based on" })]],
		["an unknown finish reason", [geminiChunk({ text: "Based on" }), geminiChunk({ finishReason: "OTHER" })]],
	])("%s → 'provider_error', never done", async (_label, chunks) => {
		const events = await collectEvents(providerUsing(fakeGoogle({ chunks }).client));
		expect(events.at(-1)).toEqual({ type: "failure", kind: "provider_error" });
		expect(events.some((e) => e.type === "done")).toBe(false);
	});
});

// ════════════════════════════════════════════════════════════════════════
// PART 3 · HELPERS
// ════════════════════════════════════════════════════════════════════════

/** A provider wired to the given (fake) Google client. */
function providerUsing(client: GeminiStreamClient): GeminiAssistantProvider {
	return new GeminiAssistantProvider(SETTINGS, () => client);
}

/** Runs stream() to the end and returns every event, in order. */
async function collectEvents(
	provider: GeminiAssistantProvider,
	signal: AbortSignal = new AbortController().signal,
): Promise<ProviderEvent[]> {
	const events: ProviderEvent[] = [];
	for await (const event of provider.stream(INPUT, signal)) events.push(event);
	return events;
}

/** A signal that is already stopped. */
function stoppedSignal(): AbortSignal {
	const controller = new AbortController();
	controller.abort();
	return controller.signal;
}

/**
 * FAKE GOOGLE: records each request, then either throws at opening,
 * or replays chunks — optionally throwing at a given chunk (dropped connection).
 */
function fakeGoogle(script: {
	chunks?: GenerateContentResponse[];
	throwAtOpening?: unknown;
	throwAtChunk?: { index: number; error: unknown };
}): { client: GeminiStreamClient; requests: GenerateContentParameters[] } {
	const requests: GenerateContentParameters[] = [];
	const client: GeminiStreamClient = {
		async generateContentStream(params) {
			requests.push(params);
			if (script.throwAtOpening !== undefined) throw script.throwAtOpening;
			return (async function* () {
				for (const [index, chunk] of (script.chunks ?? []).entries()) {
					if (script.throwAtChunk?.index === index) throw script.throwAtChunk.error;
					yield chunk;
				}
			})();
		},
	};
	return { client, requests };
}

/** A chunk shaped like the spike output: optional text, thought, finish reason, usage, block. */
function geminiChunk(opts: {
	text?: string;
	thought?: string;
	finishReason?: string;
	usage?: { promptTokenCount: number; candidatesTokenCount: number; thoughtsTokenCount?: number };
	blockReason?: string;
}): GenerateContentResponse {
	const parts = [
		...(opts.thought !== undefined ? [{ text: opts.thought, thought: true }] : []),
		...(opts.text !== undefined ? [{ text: opts.text }] : []),
	];
	return {
		candidates: opts.blockReason
			? undefined
			: [{ content: { parts, role: "model" }, index: 0, finishReason: opts.finishReason }],
		usageMetadata: opts.usage,
		promptFeedback: opts.blockReason ? { blockReason: opts.blockReason } : undefined,
	} as unknown as GenerateContentResponse; // test data, not a real SDK instance
}

/** An error like the SDK's ApiError: only `status` matters to the provider. */
function providerError(status: number): Error {
	return Object.assign(new Error(`provider status ${status}`), { name: "ApiError", status });
}