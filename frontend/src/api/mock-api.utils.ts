import { mockSession } from "../mocks/workspace.mock";

const MOCK_API_DELAY_MS = 150;


/**
 * Obj: Serves as a custom error class for handling API-related failures 
 *      within the mock environment.
 * Sub functionalities:
 *  + Inherits from the native JavaScript Error base class.
    + Captures and stores an HTTP status code (statusCode).
    + Sets the error's name property to "MockApiError" for easy identification.
 */

export class MockApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "MockApiError";
  }
}


/**
 * Objective: Creates a deep copy of a given mock data object or value.
 *            Its mocks the behaviour of backend which returns a JSON, 
 *            not reference to database.
   Sub functionalities:
    + Uses structuredClone() to perform a deep clone.
    + Preserves generic type safety (T) between the input and output.
    + Prevents accidental mutation of state in the source mock data

 */

export function cloneMockValue<T>(value: T): T {
  return structuredClone(value);
}


/**
 * Objecitve: Verifies that a user is currently logged in and retrieves their unique ID.
  Sub functionalities:
    + Checks mockSession.currentUserId for the presence of an active session.
    + Throws a MockApiError with a 401 status if no session exists.
    + Returns the authenticated user's ID as a string if verified.
 * 
 */


/**TODO: change to localStorage if needed`, to be consistent  */
export function requireAuthenticatedUserId(): string {
  if (!mockSession.currentUserId) {
    throw new MockApiError(401, "Authentication is required.");
  }
  return mockSession.currentUserId;
}

/**
 * Objective: Simulates network latency for asynchronous API calls.
    Sub functionalities:
    + Returns a JavaScript Promise.
    + Utilizes setTimeout to delay execution by MOCK_API_DELAY_MS (150ms).

    Note on Promise:
    Promise: represent eventual completion or failure of an asynchronous operation
    Use case: when operations take time to complete, they permit not to block execution of code
              works in synchrony with await keyword
 */

export function waitForMockApi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, MOCK_API_DELAY_MS); //resolve solve Promise
  });
}