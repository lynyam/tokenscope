/**
 * AssistantContext, 
 * - the stream-event types: start/delta/done/error 
 * - normalized provider results
 * - error codes. 
 * Temporarily mirrors C06 snapshot types until TSE-71 exports them
 */


/**
 * Objective: types shared by the assistant controller/service and handed to
 *            TSE-81: the fixed context, SSE events and safe error codes.
 */
import type { AnalyticsSnapshot } from './assistant-analytics.port';
import type { ProviderUsage } from './assistant.provider';

/** The fixed, allowlisted facts used for ONE answer (also sent in `start`). */
export type AssistantContext = Pick<
  AnalyticsSnapshot,
  'snapshotId' | 'generatedAt' | 'window' | 'filters' | 'summary' | 'series' | 'byModel'
> & {
  project: { id: string; name: string; description: string | null };
  pricing: { currency: 'USD'; containsSyntheticPricing: boolean };
};

/** Limits from the ticket, in one place. */
export const ASSISTANT_LIMITS = {
  questionMaxChars: 2000,
  bodyMaxBytes: 8 * 1024,
  maxIntervalDays: 90,
  contextMaxBytes: 32 * 1024,
  sseFrameMaxBytes: 64 * 1024,
  maxOutputTokens: 600,
  firstTextDeadlineMs: 15_000,
  totalDeadlineMs: 60_000,
  accessRecheckIntervalMs: 5_000,
  userRequestsPerMinute: 5,
  projectRequestsPerMinute: 30,
  activeRequestsPerUser: 1,
} as const;

/** Safe error codes owned by the assistant (others reuse existing codes). */
export type AssistantErrorCode =
  | 'VALIDATION_ERROR'
  | 'PAYLOAD_TOO_LARGE'
  | 'PROJECT_NOT_FOUND'
  | 'ACCESS_TOKEN_EXPIRED'
  | 'ASSISTANT_NO_DATA'
  | 'ASSISTANT_CONTEXT_TOO_LARGE'
  | 'ASSISTANT_ALREADY_RUNNING'
  | 'RATE_LIMITED'
  | 'LLM_REFUSED'
  | 'LLM_UNAVAILABLE'
  | 'LLM_PROVIDER_BUSY'
  | 'LLM_PROVIDER_ERROR'
  | 'LLM_TIMEOUT'
  | 'INTERNAL_SERVER_ERROR';

/** SSE events, in protocol order: start → delta* → (done | error). */
export type AssistantStartEvent = {
  event: 'start';
  data: { requestId: string; provider: 'gemini'; model: string; context: AssistantContext };
};
export type AssistantDeltaEvent = { event: 'delta'; data: { text: string } };
export type AssistantDoneEvent = {
  event: 'done';
  data: { requestId: string; finishReason: 'stop' | 'length'; usage: ProviderUsage };
};
export type AssistantErrorEvent = {
  event: 'error';
  data: { requestId: string; code: AssistantErrorCode; message: string; retryable: boolean };
};

export type AssistantStreamEvent =
  | AssistantStartEvent
  | AssistantDeltaEvent
  | AssistantDoneEvent
  | AssistantErrorEvent;