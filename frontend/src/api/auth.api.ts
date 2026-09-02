import { mockAccounts, mockSession, mockUsers,} from "../mocks/workspace.mock";
import type { SignInInput, SignUpInput, User, } from "../types/workspace.types";
import { cloneMockValue, MockApiError, waitForMockApi, } from "./mock-api.utils";

//local storage key
const SESSION_STORAGE_KEY = "mockSession";
const USERS_STORAGE_KEY = "mockUsersData";
const ACCOUNTS_STORAGE_KEY = "mockAccountsData";

/**
 * Loads the current user list from localStorage
 */

function loadUsers(): User[] {
  const stored = localStorage.getItem(USERS_STORAGE_KEY);
  return stored ? JSON.parse(stored) : cloneMockValue(mockUsers);
}

/**
 * ADDED: Loads account/password records from localStorage.
 */
function loadAccounts(): { userId: string; password: string }[] {
  const stored = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
  return stored ? JSON.parse(stored) : cloneMockValue(mockAccounts);
}

//Variables to load users and accounts from localStorage or fallback to mock data if not present.
let users: User[] = loadUsers();
let accounts: { userId: string; password: string }[] = loadAccounts();


//Store the current session in localStorage to persist across page reloads.
function persistUsers(): void {
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
}

function persistAccounts(): void {
  localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
}



/**
 * Objective: Fetches the profile data of the currently logged-in user.

  Key Subfunctionalities:
  + Simulates network latency via waitForMockApi().
  + Checks mockSession to see if a user ID is present; returns null if unauthenticated.
  + Searches mockUsers to locate the matching user profile.
  + Performs session cleanup by setting mockSession.currentUserId to null if the stored ID does not match any user.
  + Returns a deep clone of the user object to avoid direct mutations.
  // ADDED:
    +1 read the persisted session id from localStorage instead of
      an in-memory mockSession object.
    +2 clear the stale/invalid session from localStorage
 */

export async function getCurrentUser(): Promise<User | null> {
  await waitForMockApi();
  //+1
  const currentUserId = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!currentUserId) {
    return null;
  }
  const user = users.find(({ id }) => id === currentUserId,);
  if (!user) {
    //+2
    localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
  return cloneMockValue(user);
}

/*
 * Objective: Authenticates a user using email and password credentials, starting a session if successful.
  * Subfunctionalities:
    + Simulates network latency via waitForMockApi().
    + Normalizes the incoming email (trims whitespace and converts to lowercase).
    + Finds the corresponding user and account credentials in mockUsers and mockAccounts.
    + Validates the provided password against stored credentials and throws a 401 MockApiError on failure.
    + Updates mockSession.currentUserId to establish the authenticated session.
    + Returns a deep copy of the authenticated user profile.
    Key Validations/processing:
    + to lower
    + validates user and password
    ADDED:
      +1 persist the session to localStorage instead of mockSession.currentUserId
*/
export async function signIn(input: SignInInput): Promise<User> {
  await waitForMockApi();
  const normalizedEmail = input.email.trim().toLowerCase();
  const user = users.find(({ email }) => email.toLowerCase() === normalizedEmail,);
  const account = user
      ? accounts.find(({ userId }) => userId === user.id) : undefined;
  if (!user || !account || account.password !== input.password) {
    throw new MockApiError(401, "Invalid email or password.");
  }
  //+!
  localStorage.setItem(SESSION_STORAGE_KEY, user.id);
  return cloneMockValue(user);
}


/**
 * Objective: Registers a new user account and automatically logs them in upon creation.
  Subfunctionalities:
    + Simulates network latency via waitForMockApi().
    + Validates required input fields (email, display name, password) and throws a 400 MockApiError if missing.
    + Checks for duplicate email addresses and throws a 409 MockApiError if conflict exists.
    + Generates a new user ID and pushes new records to mockUsers and mockAccounts.
    + Sets mockSession.currentUserId to log the new user in immediately.
    + Returns a deep clone of the newly created user profile.
  Key Validations:
    + non duplicate: email
    + all field must exist: email, display name, password
    // ADDED:
      +1 persist the newly created session to localStorage.
 */
export async function signUp(input: SignUpInput): Promise<User> {
  await waitForMockApi();
  const normalizedEmail = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();

  if (!normalizedEmail || !displayName || !input.password) {
    throw new MockApiError(400, "All sign-up fields are required.");
  }
  const emailAlreadyExists = users.some(({ email }) => email.toLowerCase() === normalizedEmail,);
  if (emailAlreadyExists) {
    throw new MockApiError(409, "An account already uses this email.");
  }
  const user: User = {
    id: `user-${users.length + 1}`,
    email: normalizedEmail,
    displayName,
  };
  users.push(user);
  accounts.push({
    userId: user.id,
    password: input.password,
  });
  persistUsers();
  persistAccounts();
  // +1
  localStorage.setItem(SESSION_STORAGE_KEY, user.id);
  return cloneMockValue(user);
}

/**
 * Objective: Logs out the current user by terminating the active mock session.
   Subfunctionalities:
    + Simulates network latency via waitForMockApi().
    + Resets mockSession.currentUserId to null.
 */
export async function signOut(): Promise<void> {
  await waitForMockApi();
  localStorage.removeItem(SESSION_STORAGE_KEY);
}
