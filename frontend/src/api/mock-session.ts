const SESSION_STORAGE_KEY = "mockSession";

export function getMockSessionUserId(): string | null {
  return localStorage.getItem(SESSION_STORAGE_KEY);
}

export function setMockSessionUserId(
  userId: string | null,
): void {
  if (userId === null) {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }

  localStorage.setItem(SESSION_STORAGE_KEY, userId);
}
