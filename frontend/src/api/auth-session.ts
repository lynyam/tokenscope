// SECURITY.md: persist only the access token. AuthContext owns the safe user.
const ACCESS_TOKEN_STORAGE_KEY = "tokenscope.accessToken";
let revision = 0;
const invalidationListeners = new Set<() => void>();

export interface AuthSessionSnapshot {
  readonly token: string | null;
  readonly revision: number;
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
}

export function saveAccessToken(token: string): void {
  localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
  revision += 1;
}

export function getAuthSessionSnapshot(): AuthSessionSnapshot {
  return { token: getAccessToken(), revision };
}

export function clearAuthSession(): void {
  localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  revision += 1;
  for (const listener of invalidationListeners) listener();
}

export function invalidateAuthSession(requestSession: AuthSessionSnapshot): void {
  // An old request must not sign out somebody who logged in after it started.
  // Comparing the token also detects another tab replacing browser storage.
  if (requestSession.revision === revision && requestSession.token === getAccessToken()) {
    clearAuthSession();
  }
}

export function subscribeToAuthInvalidation(listener: () => void): () => void {
  invalidationListeners.add(listener);
  return () => { invalidationListeners.delete(listener); };
}
