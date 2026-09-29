import { 
  apiRequest, 
  setStoredToken, 
  clearStoredToken, 
  getStoredToken } from "./http-client";
import type { SignInInput, SignUpInput, User, } from "../types/workspace.types";

/* The AuthResponse shape from API.md*/
interface AuthResponse {
  user: User;
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

/**
 * Objective: Fetches the profile data of the currently logged-in user.
 * short-circuits to null if there's no token at all, avoiding a
 * guaranteed-401 round trip on first page load for a logged-out visitor;
 * otherwise, it makes a real HTTP call to the backend to retrieve the user data.
 */

export async function getCurrentUser(): Promise<User | null> {
  if (!getStoredToken()) {
    return null;
  }
  try {
    return await apiRequest<User>("/auth/me");
  } catch {
    clearStoredToken();
    return null;
  }
}

/*
 * Objective: Authenticates a user using email and password credentials, starting a session if successful.
 * SignInInput (email, password), real HTTP call.
*/
export async function signIn(input: SignInInput): Promise<User> {
  const response = await apiRequest<AuthResponse>("/auth/signin", {
    method: "POST",
    body: input,
    skipAuth: true,
  });
  setStoredToken(response.accessToken);

  return response.user;
}


/**
 * Objective: Registers a new user account and automatically logs them in upon creation.
 * SignUpInput (email, password, displayName), real HTTP call.
 */
export async function signUp(input: SignUpInput): Promise<User> {
  const response = await apiRequest<AuthResponse>("/auth/signup", {
    method: "POST",
    body: input,
    skipAuth: true,
  });
  setStoredToken(response.accessToken);
  return response.user;
}

/**
 * Objective: Logs out the current user by terminating the active mock session.
 * "signing out" is still purely a frontend action.
 */
export async function signOut(): Promise<void> {
  clearStoredToken();
}
