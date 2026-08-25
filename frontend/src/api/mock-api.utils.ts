import { mockSession } from "../mocks/workspace.mock";

const MOCK_API_DELAY_MS = 150;

export class MockApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "MockApiError";
  }
}

export function cloneMockValue<T>(value: T): T {
  return structuredClone(value);
}

export function requireAuthenticatedUserId(): string {
  if (!mockSession.currentUserId) {
    throw new MockApiError(401, "Authentication is required.");
  }
  return mockSession.currentUserId;
}

export function waitForMockApi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, MOCK_API_DELAY_MS);
  });
}