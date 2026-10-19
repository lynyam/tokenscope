export interface ProjectSubscription {
  organizationId: string;
  projectId: string;
}
export interface TraceNotification {
  eventId: string;
  projectId: string;
  occurredAt: string;
}
export interface AccessRevoked {
  projectId: string;
  code: "PROJECT_NOT_FOUND";
}
export const REALTIME_ERRORS = {
  AUTHENTICATION_REQUIRED: "Authentication is required.",
  INVALID_ACCESS_TOKEN: "The access token is invalid.",
  ACCESS_TOKEN_EXPIRED: "The access token has expired.",
  VALIDATION_ERROR: "Request validation failed.",
  PROJECT_NOT_FOUND: "Project not found.",
  RATE_LIMITED: "Too many realtime requests or connections.",
  INTERNAL_SERVER_ERROR: "Realtime is temporarily unavailable.",
} as const;
export type RealtimeErrorCode = keyof typeof REALTIME_ERRORS;
export interface RealtimeError { code: RealtimeErrorCode; message: string }
export type RealtimeAck =
  | { ok: true; projectId?: string }
  | { ok: false; error: RealtimeError };
export const realtimeError = (code: RealtimeErrorCode): RealtimeError =>
  ({ code, message: REALTIME_ERRORS[code] });
export const rejected = (code: RealtimeErrorCode): RealtimeAck =>
  ({ ok: false, error: realtimeError(code) });
