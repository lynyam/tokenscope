import type { AssistantProvider } from "../../src/assistant/assistant.provider";
import type { AssistantContext, ProviderEvent } from "../../src/assistant/assistant.types";

// A pause in the fake answer, opened by the test with open().
export interface Gate {
	wait: Promise<void>;
	open: () => void;
}

// Creates a gate the fake provider waits on.
export function gate(): Gate {
	let open = () => undefined as void;
	const wait = new Promise<void>(resolve => {
		open = resolve;
	});
	return { wait, open };
}

export type FakeStep = ProviderEvent | Gate | { throws: Error };

// Fake LLM: plays a script of events. Never calls Gemini.
export class FakeAssistantProvider implements AssistantProvider {
	readonly name = "gemini" as const;
	model = "deterministic-test-only";
	configured = true;
	script: FakeStep[] = [];
	calls = 0;
	pulled = 0; // how many events the service has read so far
	lastSignal: AbortSignal | null = null;
	lastQuestion: string | null = null;
	lastContext: AssistantContext | null = null;

	isConfigured(): boolean {
		return this.configured;
	}

	// Yields each scripted event; waits on gates; stops when aborted.
	// Like Gemini, it sends "open" before its first delta/done (not before an early failure).
	async *stream(question: string, context: AssistantContext, signal: AbortSignal): AsyncGenerator<ProviderEvent> {
		this.calls += 1;
		this.lastSignal = signal;
		this.lastQuestion = question;
		this.lastContext = structuredClone(context);
		let opened = false;

		for (const step of this.script) {
			if (signal.aborted) return;
			if ("wait" in step) {
				await Promise.race([step.wait, aborted(signal)]);
			} else if ("throws" in step) {
				throw step.throws;
			} else {
				if (step.type === "open") {
					opened = true;
				} else if (!opened && step.type !== "failure") {
					opened = true;
					yield { type: "open" };
				}
				if (step.type !== "open") this.pulled += 1;
				yield step;
			}
		}
	}

	reset(): void {
		this.model = "deterministic-test-only";
		this.configured = true;
		this.script = [];
		this.calls = 0;
		this.pulled = 0;
		this.lastSignal = null;
		this.lastQuestion = null;
		this.lastContext = null;
	}
}

// Resolves when the signal aborts.
function aborted(signal: AbortSignal): Promise<void> {
	return new Promise(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
}

// Short helpers for scripts.
export const open = (): ProviderEvent => ({ type: "open" });
export const delta = (text: string): ProviderEvent => ({ type: "delta", text });
export const done = (finishReason: "stop" | "length" = "stop"): ProviderEvent =>
	({ type: "done", finishReason, usage: null });
export const failure = (kind: "refused" | "unavailable" | "busy" | "provider_error"): ProviderEvent =>
	({ type: "failure", kind });
