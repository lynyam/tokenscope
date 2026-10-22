import type { AssistantContext, ProviderEvent } from "./assistant.types";

// Nest injection token. Tests replace the provider with a fake through this.
export const ASSISTANT_PROVIDER = Symbol("ASSISTANT_PROVIDER");

// The small contract every LLM provider must follow.
export interface AssistantProvider {
	readonly name: "gemini";
	readonly model: string;

	// True when the key and the model are set.
	isConfigured(): boolean;

	// Streams the answer as simple events. Stops when `signal` aborts.
	stream(question: string, context: AssistantContext, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}
