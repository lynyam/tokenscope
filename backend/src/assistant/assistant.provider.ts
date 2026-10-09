/**
 * The AssistantProvide: response shape that gemini provider returns to the assistant service.
 */

/**
 * Objective: application-owned contract between the assistant service and
 *            any LLM provider implementation (Gemini in this MVP).
 * Rules:
 *  + No SDK types here: only the Gemini implementation imports @google/genai.
 *  + Tests replace the provider through Nest DI using ASSISTANT_PROVIDER.
 */
export const ASSISTANT_PROVIDER = Symbol('ASSISTANT_PROVIDER');

/** What the provider receives: fixed instructions kept separate from data. */
export type ProviderInput = {
  instructions: string; // fixed application instructions (system instruction)
  content: string; // delimited context data + user question
};

export type ProviderUsage = { inputTokens: number; outputTokens: number } | null;

/** Normalized failure kinds; the service maps them to HTTP/SSE codes. */
export type ProviderFailureKind =
  | 'refused' // safety block / refusal          → 422 LLM_REFUSED
  | 'busy' // quota or capacity (provider 429) → 503 LLM_PROVIDER_BUSY
  | 'unavailable' // bad key / model / config        → 503 LLM_UNAVAILABLE
  | 'provider_error'; // anything else, incl. empty/odd → 502 LLM_PROVIDER_ERROR

/** Normalized events produced by every provider implementation. */
export type ProviderEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; finishReason: 'stop' | 'length'; usage: ProviderUsage }
  | { type: 'failure'; kind: ProviderFailureKind };

export interface AssistantProvider {
  readonly name: 'gemini';
  readonly model: string;

  /** False when key/model configuration is missing → 503 LLM_UNAVAILABLE. */
  isConfigured(): boolean;

  /**
   * Starts ONE provider request (no retries) and yields normalized events.
   * Must stop promptly when `signal` aborts. Ends after `done` or `failure`.
   */
  stream(input: ProviderInput, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}