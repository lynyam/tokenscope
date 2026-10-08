import { apiGet, apiPost } from "./http-client";
import type { AuthResponse, SignInInput, SignUpInput, User, } from "../types/workspace.types";



/**
 * AuthContext calls this only when an access token exists.
 *
 * Let failures propagate:
 * - the shared client handles protected 401 invalidation;
 * - AuthContext can offer a retry for network/server failures.
 */

export function getCurrentUser(
  signal?: AbortSignal,
): Promise<User> {
  return apiGet<User>("/auth/me", { signal });
}
/**
 * Return the complete backend response.
 * AuthContext decides whether this attempt may update the session.
 */
export function signIn(
  input: SignInInput,
): Promise<AuthResponse> {
  return apiPost<AuthResponse>(
    "/auth/signin",
    {
      email: input.email,
      password: input.password,
    },
    { auth: "none" },
  );
}

export function signUp(
  input: SignUpInput,
): Promise<AuthResponse> {
  return apiPost<AuthResponse>(
    "/auth/signup",
    {
      email: input.email,
      password: input.password,
      displayName: input.displayName,
    },
    { auth: "none" },
  );
}
