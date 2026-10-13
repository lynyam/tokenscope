/**
 * GEMINI ASSISTANT PROVIDER — the only file that talks to Google Gemini.
 *
 * THE BIG TASK — stream(input, signal):
 *   Answer ONE question with Gemini and report it as neutral events:
 *     delta, delta, …  then exactly one ending: done (stop | length) or failure.
 *
 * HOW (4 steps, see stream()):
 *   1. Am I ready?             no key/model → failure("unavailable")
 *   2. Open the call           one SDK request, no retries
 *   3. Relay what Gemini says  visible text → delta (thoughts skipped, never trimmed)
 *   4. Report how it ended     finish reason + text received → done or failure
 *
 * RULE: if the stop signal fires at any point, stop quietly (no event).
 *       The assistant service decides what to tell the user.
 *
 * FILE LAYOUT:
 *   PART 1  Setup (settings, client, no-retry option)
 *   PART 2  The main task (class)
 *   PART 3  Sub-functions (reading chunks, endings, errors, reference lists)
 */



//// Diagram illustrating the flow of stream() and its 4 steps
/*
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │            GeminiAssistantProvider.stream(input, signal) — FLOW              │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 *  AssistantService ──calls──▶ stream(input, signal)
 *      ▲                         │
 *      │                         ▼
 *      │   STEP 1 · AM I READY?
 *      │     no client (no key/model) ──────────────▶ yield failure("unavailable") ─┐
 *      │     signal already aborted   ──────────────▶ return (no event)            │
 *      │                         │                                                 │
 *      │                         ▼                                                 │
 *      │   STEP 2 · OPEN THE CALL — openCall() → buildRequest()                    │
 *      │     ┌──────────────────────────────────────────────┐                      │
 *      │     │ await client.generateContentStream(request)   │ ⏳ waits for Google  │
 *      │     │   model · systemInstruction · contents        │    (~0.6–1 s)        │
 *      │     │   maxOutputTokens 600 · candidateCount 1      │                      │
 *      │     │   abortSignal · NO tools · attempts = 1       │                      │
 *      │     └──────────────────────────────────────────────┘                      │
 *      │       ├─ opened ─────────────────────────────▶ continue to STEP 3         │
 *      │       ├─ error 429 / 503 ────────────────────▶ yield failure("busy") ─────┤
 *      │       ├─ error 400 / 401 / 403 / 404 ────────▶ yield failure("unavailable")┤
 *      │       ├─ other error ────────────────────────▶ yield failure("provider_error")
 *      │       └─ stopped by signal ──────────────────▶ return (no event)          │
 *      │                         │                                                 │
 *      │                         ▼                                                 │
 *      │   STEP 3 · RELAY — relayChunks()  (for await … each chunk)  ⏳ chunk by chunk
 *      │     readChunk(chunk) → { blocked, texts, finishReason, usage }            │
 *      │       ├─ blocked (promptFeedback) ───────────▶ yield failure("refused") ──┤
 *      │       ├─ texts (thoughts skipped, untrimmed) ▶ yield delta { text } ──────┤ (0..n)
 *      │       ├─ usage ─────────────▶ remember latest ┐                           │
 *      │       ├─ finishReason ──────▶ remember        ├─▶ StreamSummary           │
 *      │       │                     (sawText = true if any delta)                │
 *      │       ├─ connection dropped ─────────────────▶ yield failure("provider_error")
 *      │       └─ signal aborted ─────────────────────▶ return (no event)          │
 *      │                         │                                                 │
 *      │                         ▼                                                 │
 *      │   STEP 4 · REPORT THE ENDING — decideEnding(summary)  (exactly one)       │
 *      │       ├─ no finishReason ────────────────────▶ failure("provider_error") ─┤
 *      │       ├─ SAFETY / PROHIBITED_CONTENT / … ────▶ failure("refused") ────────┤
 *      │       ├─ no text received ───────────────────▶ failure("provider_error") ─┤
 *      │       ├─ STOP ───────────────────────────────▶ done { stop, usage } ──────┤
 *      │       ├─ MAX_TOKENS ─────────────────────────▶ done { length, usage } ────┤
 *      │       └─ anything else ──────────────────────▶ failure("provider_error") ─┤
 *      │                                                                           │
 *      └──────────────── events received one by one (for await) ◀─────────────────┘
 *
 *  EVENT ORDER SEEN BY THE SERVICE:   delta* → ( done | failure )   — or nothing if stopped
 *
 *  ⏳ = waiting points. At each one, if the AssistantService fires `signal`
 *       (Stop, timeout, JWT expiry, lost access, shutdown) → stop quietly, no event.
 *
 *  NOT HERE: HTTP, SSE frames, the browser, limits, deadlines.
 *            The AssistantService decides those and uses sse-writer.ts.
 *
 *  Where the events go next (Phase 5):
 *     stream() ──▶ AssistantService ──▶ sse-writer.ts ──▶ browser (SSE)
 */



import { GoogleGenAI } from "@google/genai";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import type {
	AssistantProvider,
	ProviderEvent,
	ProviderFailureKind,
	ProviderInput,
	ProviderUsage,
} from "./assistant.provider";
import { ASSISTANT_LIMITS } from "./assistant.types";

// ════════════════════════════════════════════════════════════════════════
// PART 1 · SETUP
// ════════════════════════════════════════════════════════════════════════

/** Validated configuration (from env.validation.ts). null = not configured. */
export interface GeminiSettings {
	apiKey: string | null;
	model: string | null;
}

/** The only SDK method we use. Tests replace it with a fake client. */
export interface GeminiStreamClient {
	generateContentStream(params: GenerateContentParameters): Promise<AsyncIterable<GenerateContentResponse>>;
}

/** Builds a client from a key. Production: real SDK. Tests: a fake. */
export type CreateGeminiClient = (apiKey: string) => GeminiStreamClient;

/** SDK options: ONE total attempt (the SDK default is 5 → hidden paid retries). */
export function buildGeminiClientOptions(apiKey: string): ConstructorParameters<typeof GoogleGenAI>[0] {
	return {
		apiKey,
		httpOptions: { retryOptions: { attempts: 1 } },
	};
}

// ════════════════════════════════════════════════════════════════════════
// PART 2 · THE MAIN TASK
// ════════════════════════════════════════════════════════════════════════

export class GeminiAssistantProvider implements AssistantProvider {
	readonly name = "gemini" as const;
	readonly model: string;
	private readonly client: GeminiStreamClient | null;

	/** Created once at startup. No key or model → no client (assistant disabled). */
	constructor(settings: GeminiSettings, createClient: CreateGeminiClient = createSdkClient) {
		this.model = settings.model ?? "unconfigured";
		this.client = settings.apiKey !== null && settings.model !== null ? createClient(settings.apiKey) : null;
	}

	isConfigured(): boolean {
		return this.client !== null;
	}

	/**
	 * THE BIG TASK: answer one question, as a stream of events.
	 * (async * = a generator that produces events one at a time with `yield`.)
	 */
	async *stream(input: ProviderInput, signal: AbortSignal): AsyncIterable<ProviderEvent> {
		// STEP 1 — Am I ready?
		if (this.client === null) {
			yield failure("unavailable");
			return;
		}
		if (signal.aborted) return;

		// STEP 2 — Open the call (config / quota / auth errors happen here).
		/**
		 * openCall: starts the conversation with Gemini and returns the stream of chunks (or why it failed).
		 */
		const call = await this.openCall(this.client, input, signal);
		if (!call.opened) {
			if (call.failure !== null) yield failure(call.failure); // null = we were stopped
			return;
		}

		// STEP 3 — Relay what Gemini says. `yield*` forwards every delta to our
		// caller and, at the end, gives back a summary (or null if it stopped early).
		/*
		 * yield: a keyword that only works inside a generator
		 * hands one event to the caller and pauses until the caller asks for the next one.
		 */
		const summary = yield* this.relayChunks(call.chunks, signal);
		if (summary === null || signal.aborted) return;

		// STEP 4 — Report how it ended: exactly one terminal event.
		yield decideEnding(summary);
	}

	// ── STEP 2 · Open the call ─────────────────────────────────────────

	/** Sends the one request. Never throws: returns the chunks, or why it failed. */
	private async openCall(client: GeminiStreamClient, input: ProviderInput, signal: AbortSignal): Promise<OpenedCall> {
		try {
			const chunks = await client.generateContentStream(this.buildRequest(input, signal));
			return { opened: true, chunks };
		} catch (error) {
			// Stopped by us → not a provider failure (null).
			return { opened: false, failure: signal.aborted ? null : classifyError(error) };
		}
	}

	/** The briefing sent to Gemini: fixed settings from TSE-80 §7.C. */
	/*
	 *  buildRequest: creates the Gemini request object from our input and the provider's model.
	 *  The request is a single object with:
	 *    model, contents, config (systemInstruction, maxOutputTokens, candidateCount, abortSignal)
	 */
	private buildRequest(input: ProviderInput, signal: AbortSignal): GenerateContentParameters {
		return {
			model: this.model,
			contents: [{ role: "user", parts: [{ text: input.content }] }],
			config: {
				systemInstruction: input.instructions, // separate from user content
				maxOutputTokens: ASSISTANT_LIMITS.maxOutputTokens, // 600
				candidateCount: 1, // one answer
				abortSignal: signal, // lets the service stop the call
				// no tools, no search, no conversation
			},
		};
	}

	// ── STEP 3 · Relay what Gemini says ────────────────────────────────

	/**
	 * Reads chunks one by one: forwards visible text as deltas and gathers
	 * what is needed for the ending (finish reason, text seen, usage).
	 * Returns the summary, or null if the stream stopped early
	 * (stopped by us, blocked, or broken — the failure was already yielded).
	 * relay chunks hands the event to stream, and stream hands it to whoever is reading stream
	 */
	private async *relayChunks(
		chunks: AsyncIterable<GenerateContentResponse>,
		signal: AbortSignal,
	): AsyncGenerator<ProviderEvent, StreamSummary | null> {
		const summary: StreamSummary = { sawText: false, finishReason: undefined, usage: null };

		try {
			for await (const chunk of chunks) {
				if (signal.aborted) return null;

				const info = readChunk(chunk); // ← gather everything this chunk says

				if (info.blocked) {
					yield failure("refused"); // prompt blocked before answering
					return null;
				}
				for (const text of info.texts) {
					summary.sawText = true;
					yield { type: "delta", text }; // relayed exactly as received
				}
				if (info.usage !== undefined) summary.usage = info.usage; // keep the latest
				if (info.finishReason !== undefined) summary.finishReason = info.finishReason;
			}
		} catch (error) {
			if (signal.aborted) return null;
			yield failure(classifyError(error)); // connection dropped mid-answer
			return null;
		}

		return summary;
	}
}

// ════════════════════════════════════════════════════════════════════════
// PART 3 · SUB-FUNCTIONS
// ════════════════════════════════════════════════════════════════════════

// ── Shapes passed between the steps ──────────────────────────────────

/** Result of STEP 2. */
type OpenedCall =
	| { opened: true; chunks: AsyncIterable<GenerateContentResponse> }
	| { opened: false; failure: ProviderFailureKind | null }; // null = stopped by us

/** What STEP 3 gathered, used by STEP 4. */
interface StreamSummary {
	sawText: boolean;
	finishReason: string | undefined;
	usage: ProviderUsage;
}

/** Everything useful found in ONE chunk. */
interface ChunkInfo {
	blocked: boolean;
	texts: string[];
	finishReason: string | undefined;
	usage: ProviderUsage | undefined; // undefined = this chunk carried no usage
}

// ── 3a · Reading one chunk ───────────────────────────────────────────

/** Extracts the useful parts of a Gemini chunk; ignores everything else (IDs, headers…). */
function readChunk(chunk: GenerateContentResponse): ChunkInfo {
	const candidate = chunk.candidates?.[0];
	return {
		blocked: Boolean(chunk.promptFeedback?.blockReason),
		texts: visibleTexts(candidate?.content?.parts ?? []),
		finishReason: candidate?.finishReason ? String(candidate.finishReason) : undefined,
		usage: chunk.usageMetadata ? toUsage(chunk.usageMetadata) : undefined,
	};
}

/** Visible answer text only: thought parts skipped, empty pieces skipped, never trimmed. */
function visibleTexts(parts: Array<{ text?: string; thought?: boolean }>): string[] {
	return parts
		.filter((part) => !part.thought && typeof part.text === "string" && part.text.length > 0)
		.map((part) => part.text as string);
}

/**
 * Provider-reported usage only (never estimated).
 * inputTokens  ← promptTokenCount
 * outputTokens ← candidatesTokenCount + thoughtsTokenCount (thinking is billed as output)
 */
function toUsage(meta: NonNullable<GenerateContentResponse["usageMetadata"]>): ProviderUsage {
	const input = meta.promptTokenCount;
	const output = meta.candidatesTokenCount;
	if (typeof input !== "number" || typeof output !== "number") return null;
	return { inputTokens: input, outputTokens: output + (meta.thoughtsTokenCount ?? 0) };
}

// ── 3b · Deciding the ending ─────────────────────────────────────────

/** Turns what STEP 3 gathered into exactly one terminal event. */
function decideEnding({ finishReason, sawText, usage }: StreamSummary): ProviderEvent {
	if (finishReason === undefined) return failure("provider_error"); // ended without a reason
	if (REFUSAL_FINISH_REASONS.has(finishReason)) return failure("refused");
	if (!sawText) return failure("provider_error"); // empty answer is not success
	if (finishReason === "STOP") return { type: "done", finishReason: "stop", usage };
	if (finishReason === "MAX_TOKENS") return { type: "done", finishReason: "length", usage };
	return failure("provider_error"); // OTHER, LANGUAGE, unknown…
}

// ── 3c · Understanding errors ────────────────────────────────────────

/** Maps a thrown error to a failure kind using its HTTP status. Never forwards the raw error. */
function classifyError(error: unknown): ProviderFailureKind {
	const status = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
	if (typeof status === "number") {
		if (BUSY_STATUSES.has(status)) return "busy";
		if (UNAVAILABLE_STATUSES.has(status)) return "unavailable";
	}
	return "provider_error"; // 5xx, network failure, malformed response…
}

// ── 3d · Small helpers and reference lists ───────────────────────────

function failure(kind: ProviderFailureKind): ProviderEvent {
	return { type: "failure", kind };
}

/** Production client factory: creating it makes NO network call. */
const createSdkClient: CreateGeminiClient = (apiKey) => new GoogleGenAI(buildGeminiClientOptions(apiKey)).models;

/** Finish reasons meaning "Google's filters blocked the answer" → 422 LLM_REFUSED. */
const REFUSAL_FINISH_REASONS = new Set([
	"SAFETY",
	"PROHIBITED_CONTENT",
	"BLOCKLIST",
	"SPII",
	"RECITATION",
	"IMAGE_SAFETY",
]);

/** "Try later": quota exhausted / model overloaded → 503 LLM_PROVIDER_BUSY. */
const BUSY_STATUSES = new Set([429, 503]);

/** "Fix the setup": bad key, permission or model → 503 LLM_UNAVAILABLE (never 401). */
const UNAVAILABLE_STATUSES = new Set([400, 401, 403, 404]);