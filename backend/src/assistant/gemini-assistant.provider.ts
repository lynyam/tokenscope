import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiError, GoogleGenAI, type Candidate, type GenerateContentResponse } from "@google/genai";

import type { EnvironmentVariables } from "../config/env.validation";
import type { AssistantProvider } from "./assistant.provider";
import { ASSISTANT_INSTRUCTIONS, buildPrompt } from "./assistant-prompt";
import type { AssistantContext, ProviderEvent, ProviderFailureKind, ProviderUsage } from "./assistant.types";

// Gemini finish reasons that mean "blocked / refused".
const REFUSAL_REASONS = ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "LANGUAGE"];

// The only file that knows about the @google/genai SDK.
@Injectable()
export class GeminiAssistantProvider implements AssistantProvider {
	readonly name = "gemini" as const;
	readonly model: string;
	private readonly client: GoogleGenAI | null;

	constructor(config: ConfigService<EnvironmentVariables>) {
		const apiKey = config.get("GEMINI_API_KEY", { infer: true });
		this.model = config.get("LLM_MODEL", { infer: true }) ?? "";

		// No network call here: the SDK only connects when we ask a question.
		// attempts: 1 = one total attempt, never an automatic retry.
		this.client = apiKey && this.model
			? new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } })
			: null;
	}

	isConfigured(): boolean {
		return this.client !== null;
	}

	// Asks Gemini and turns its chunks into delta / done / failure events.
	async *stream(question: string, context: AssistantContext, signal: AbortSignal): AsyncGenerator<ProviderEvent> {
		if (!this.client) {
			yield { type: "failure", kind: "unavailable" };
			return;
		}

		// Step 1: open the request. HTTP errors (bad key, quota...) happen here.
		let chunks: AsyncGenerator<GenerateContentResponse>;
		try {
			chunks = await this.client.models.generateContentStream({
				model: this.model,
				contents: buildPrompt(question, context),
				config: {
					systemInstruction: ASSISTANT_INSTRUCTIONS,
					candidateCount: 1,
					maxOutputTokens: 600,
					abortSignal: signal,
					automaticContinuation: false,
				},
			});
		} catch (error) {
			yield { type: "failure", kind: failureKind(error) };
			return;
		}

		// Gemini accepted the request (the HTTP call really happened above).
		yield { type: "open" };

		// Step 2: read the chunks one by one.
		let finishReason: string | undefined;
		let usage: ProviderUsage | null = null;

		try {
			for await (const chunk of chunks) {
				if (chunk.promptFeedback?.blockReason) {
					yield { type: "failure", kind: "refused" };
					return;
				}

				if (chunk.candidates !== undefined && (!Array.isArray(chunk.candidates) || chunk.candidates.length > 1)) {
					throw new Error("Malformed candidates");
				}
				const candidate = chunk.candidates?.[0];
				const reason = candidate?.finishReason;
				if (reason && REFUSAL_REASONS.includes(reason)) {
					yield { type: "failure", kind: "refused" };
					return;
				}
				if (reason && reason !== "STOP" && reason !== "MAX_TOKENS") {
					yield { type: "failure", kind: "provider_error" };
					return;
				}
				const text = visibleText(candidate);
				if (text !== "") {
					yield { type: "delta", text };
				}

				if (chunk.usageMetadata) {
					usage = toUsage(chunk.usageMetadata);
				}
				if (candidate?.finishReason) {
					finishReason = candidate.finishReason;
				}
			}
		} catch (error) {
			yield { type: "failure", kind: failureKind(error) };
			return;
		}

		// Step 3: decide how the answer ended.
		if (finishReason === "STOP") {
			yield { type: "done", finishReason: "stop", usage };
		} else if (finishReason === "MAX_TOKENS") {
			yield { type: "done", finishReason: "length", usage };
		} else if (finishReason && REFUSAL_REASONS.includes(finishReason)) {
			yield { type: "failure", kind: "refused" };
		} else {
			// No finish reason (cut stream) or an unexpected one.
			yield { type: "failure", kind: "provider_error" };
		}
	}
}

// Joins the text parts the user may see. Skips "thought" (reasoning) parts.
function visibleText(candidate: Candidate | undefined): string {
	let text = "";
	const parts = candidate?.content?.parts ?? [];
	if (!Array.isArray(parts)) throw new Error("Malformed parts");
	for (const part of parts) {
		if (!part || typeof part !== "object" ||
			(part.text !== undefined && typeof part.text !== "string") ||
			(part.thought !== undefined && typeof part.thought !== "boolean")) {
			throw new Error("Malformed text part");
		}
		if (!part.thought && typeof part.text === "string") {
			text += part.text;
		}
	}
	return text;
}

// Gemini usage fields -> our usage. null when Gemini did not report them.
function toUsage(metadata: NonNullable<GenerateContentResponse["usageMetadata"]>): ProviderUsage | null {
	const input = metadata.promptTokenCount;
	const output = metadata.candidatesTokenCount;

	if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0 ||
		typeof output !== "number" || !Number.isSafeInteger(output) || output < 0) {
		return null;
	}
	return { inputTokens: input, outputTokens: output };
}

// Maps an SDK error to a safe failure kind. Never forwards the raw error.
function failureKind(error: unknown): ProviderFailureKind {
	if (!(error instanceof ApiError)) {
		return "provider_error";
	}
	// 400/401/403: bad or missing key. 404: unknown model. All are backend config problems.
	if ([400, 401, 403, 404].includes(error.status)) {
		return "unavailable";
	}
	// 429: quota. 503: Google overloaded.
	if (error.status === 429 || error.status === 503) {
		return "busy";
	}
	return "provider_error";
}
