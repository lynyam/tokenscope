import type { AuthenticatedUser } from "./authenticated-user";
import type { RequestWithRequestId } from "./request-with-request-id";

/**
 * Objective: a request that passed JwtAuthGuard.
 * Sub functionalities:
 *  + user: the verified identity (sub), nothing else from the token.
 *  + accessTokenExpiresAt: VERIFIED expiry in epoch milliseconds, used by
 *    streaming endpoints (TSE-80) to stop output when the session ends.
 *    Kept separate from `user` so public user shapes stay unchanged.
 */
export type AuthenticatedRequest = RequestWithRequestId & {
	user: AuthenticatedUser;
	accessTokenExpiresAt: number;
};