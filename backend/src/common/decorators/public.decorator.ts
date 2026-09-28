import { SetMetadata } from "@nestjs/common";

/**
 * Opt-out mechanism for the global auth guard.
 *
 * JwtAuthGuard is registered globally (see auth.module.ts, STEP 9), so
 * every route is protected by default. @Public() marks the small set of
 * routes API.md lists as unauthenticated: /auth/signup, /auth/signin,
 * /health, /health/db.
 */
export const IS_PUBLIC_KEY = "isPublic";

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);