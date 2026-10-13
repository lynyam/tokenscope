/**
 * FAKE ASSISTANT PROVIDER — a scripted stand-in for Gemini, used ONLY in tests.
 *
 * THE BIG TASK — stream(input, signal):
 *   Behave, as seen from the AssistantService, exactly like GeminiAssistantProvider:
 *   emit delta, delta, … then done or failure — but from a SCRIPT, not from Google.
 *
 * HOW (same 4 steps as the real provider):
 *   1. Am I ready?           not configured → failure("unavailable")
 *   2. "Open the call"       record the input (what Gemini would have received)
 *   3. Play the script       events are yielded, waits are waited, hangs hang
 *   4. The ending            whatever the script's last event says
 *
 * RULE: if the stop signal fires at any point, stop quietly and count it
 *       (abortedCount) — this is how tests prove cancellation really happened.
 *
 * WHAT IT DOES NOT IMITATE: Google's chunks, SDK errors, finish reasons.
 *   The script already contains the NORMALIZED events the real provider would
 *   produce — the translation work is tested separately in the Gemini unit tests.
 *
 * FILE LAYOUT:
 *   PART 1  Setup (step types, ready-made scripts)
 *   PART 2  The main task (class)
 *   PART 3  Sub-functions (performing one step, waiting)
 */

/*
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │            FakeAssistantProvider.stream(input, signal) — FLOW                │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 *  AssistantService (under test) ──calls──▶ stream(input, signal)
 *      ▲                                      │
 *      │                                      ▼
 *      │   STEP 1 · AM I READY?                         (Gemini: same step)
 *      │     configured = false ───────────────────────▶ yield failure("unavailable") ┐
 *      │     signal already aborted ───────────────────▶ count abort, return         │
 *      │                                      │                                      │
 *      │                                      ▼                                      │
 *      │   STEP 2 · "OPEN THE CALL"                     (Gemini: openCall)           │
 *      │     inputs.push(input)   ← tests later inspect what was "sent to Google"    │
 *      │                                      │                                      │
 *      │                                      ▼                                      │
 *      │   STEP 3 · PLAY THE SCRIPT — performStep() for each step                    │
 *      │                                                (Gemini: relayChunks)        │
 *      │     before each step: signal aborted? ────────▶ count abort, return         │
 *      │       ├─ event step (delta/done/failure) ─────▶ yield it ───────────────────┤
 *      │       ├─ { type: "wait", ms } ──── ⏳ pause(ms)                              │
 *      │       │      stopped during the pause ────────▶ count abort, return         │
 *      │       └─ { type: "hang" } ──────── ⏳ waitUntilStopped()                     │
 *      │              (only ends when the signal fires) ▶ count abort, return        │
 *      │                                      │                                      │
 *      │                                      ▼                                      │
 *      │   STEP 4 · THE ENDING                          (Gemini: decideEnding)       │
 *      │     = the script's own final event (done / failure), already yielded        │
 *      │     a script WITHOUT a final event simply ends → lets tests check how the   │
 *      │     service reacts to a stream that stops without a terminal event         │
 *      │                                                                             │
 *      └──────────────── events received one by one (for await) ◀────────────────────┘
 *
 *  ⏳ = waiting points, where Stop / timeouts / lost access are tested.
 *
 *  TEST INSTRUMENTS:  inputs        → what the service sent (privacy/allowlist checks)
 *                     abortedCount  → proof that cancellation reached the provider
 */

import { setTimeout as delay } from "node:timers/promises";
import type {
	AssistantProvider,
	ProviderEvent,
	ProviderInput,
} from "../../src/assistant/assistant.provider";

// ════════════════════════════════════════════════════════════════════════
// PART 1 · SETUP
// ════════════════════════════════════════════════════════════════════════

/** One line of a script: emit an event, pause, or hang until stopped. */
export type FakeStep =
	| ProviderEvent // delta / done / failure — emitted as is
	| { type: "wait"; ms: number } // simulate Gemini being slow
	| { type: "hang" }; // simulate Gemini stalling forever

const USAGE = { inputTokens: 165, outputTokens: 12 };

/** Ready-made scripts for the scenarios tested in Phases 5–6. */
export const SCRIPTS = {
	/** Complete answer (Gemini: STOP). */
	normal: [
		{ type: "delta", text: "Based on" },
		{ type: "delta", text: " the DATA, demo-large contributes most." },
		{ type: "done", finishReason: "stop", usage: USAGE },
	],
	/** Cut at the token limit (Gemini: MAX_TOKENS). */
	truncated: [
		{ type: "delta", text: "Based on the DATA, the model is `" },
		{ type: "done", finishReason: "length", usage: USAGE },
	],
	/** Blocked before any text (Gemini: promptFeedback.blockReason). */
	refusedAtStart: [{ type: "failure", kind: "refused" }],
	/** Blocked after some text (Gemini: SAFETY after a delta). */
	refusedMidAnswer: [
		{ type: "delta", text: "Based on" },
		{ type: "failure", kind: "refused" },
	],
	/** Quota exhausted (Gemini: 429). */
	busy: [{ type: "failure", kind: "busy" }],
	/** Connection dropped mid-answer. */
	droppedMidAnswer: [
		{ type: "delta", text: "Based on" },
		{ type: "failure", kind: "provider_error" },
	],
	/** Never says anything (tests the 15 s first-text deadline and early Stop). */
	stallsBeforeText: [{ type: "hang" }],
	/** Starts, then stalls (tests the 60 s total deadline and Stop mid-answer). */
	stallsMidAnswer: [{ type: "delta", text: "Based on" }, { type: "hang" }],
} satisfies Record<string, FakeStep[]>;

/** Kept for compatibility with earlier code. */
export const NORMAL_ANSWER: FakeStep[] = SCRIPTS.normal;

// ════════════════════════════════════════════════════════════════════════
// PART 2 · THE MAIN TASK
// ════════════════════════════════════════════════════════════════════════

export class FakeAssistantProvider implements AssistantProvider {
	readonly name = "gemini" as const; // same badge as the real provider
	readonly model = "fake-model";

	/** TEST INSTRUMENT: every input the service sent ("what Google would have seen"). */
	readonly inputs: ProviderInput[] = [];
	/** TEST INSTRUMENT: how many times the stop signal reached this provider. */
	abortedCount = 0;

	constructor(
		private readonly script: FakeStep[] = SCRIPTS.normal,
		private readonly configured = true,
	) {}

	isConfigured(): boolean {
		return this.configured;
	}

	/** THE BIG TASK: replay the script as a stream of events, like Gemini would. */
	async *stream(input: ProviderInput, signal: AbortSignal): AsyncIterable<ProviderEvent> {
		// STEP 1 — Am I ready?
		if (!this.configured) {
			yield { type: "failure", kind: "unavailable" };
			return;
		}
		if (signal.aborted) return this.recordAbort();

		// STEP 2 — "Open the call": remember what Gemini would have received.
		this.inputs.push(input);

		// STEP 3 — Play the script, one step at a time.
		for (const step of this.script) {
			if (signal.aborted) return this.recordAbort();

			const outcome = await performStep(step, signal);
			if (outcome.kind === "stopped") return this.recordAbort();
			if (outcome.kind === "emit") yield outcome.event;
			// outcome "next" → a wait finished normally, go to the next step
		}

		// STEP 4 — The ending is the script's own last event (already yielded).
	}

	private recordAbort(): void {
		this.abortedCount += 1;
	}
}

// ════════════════════════════════════════════════════════════════════════
// PART 3 · SUB-FUNCTIONS
// ════════════════════════════════════════════════════════════════════════

/** What performing one step produced. */
type StepOutcome =
	| { kind: "emit"; event: ProviderEvent } // an event to yield
	| { kind: "next" } // a pause finished: continue
	| { kind: "stopped" }; // the signal fired while waiting

/** Performs one script step: emit, pause or hang. */
async function performStep(step: FakeStep, signal: AbortSignal): Promise<StepOutcome> {
	if (step.type === "wait") {
		const finished = await pause(step.ms, signal);
		return finished ? { kind: "next" } : { kind: "stopped" };
	}
	if (step.type === "hang") {
		await waitUntilStopped(signal);
		return { kind: "stopped" };
	}
	return { kind: "emit", event: step }; // delta / done / failure
}

/**
 * Waits `ms` milliseconds unless the signal fires first.
 * Returns true if the pause completed, false if it was stopped.
 * (timers/promises `delay` rejects when its signal aborts.)
 */
async function pause(ms: number, signal: AbortSignal): Promise<boolean> {
	try {
		await delay(ms, undefined, { signal });
		return true;
	} catch {
		return false;
	}
}

/** Resolves only when the signal fires — simulates a provider that never answers. */
function waitUntilStopped(signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}