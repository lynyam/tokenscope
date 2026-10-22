import type { AuthenticatedUser } from "./authenticated-user";
import type { RequestWithRequestId } from "./request-with-request-id";

// A request that passed JwtAuthGuard.
export interface AuthenticatedRequest extends RequestWithRequestId {
	user: AuthenticatedUser;
	// When the verified JWT expires, in epoch milliseconds.
	accessTokenExpiresAt: number;
	// Exact JSON bytes, kept because main.ts enables rawBody.
	rawBody?: Buffer;
}
