/*import { User } from '../types/workspace.types'
import { mockUsers } from '../mocks/workspace.mock'

//getcurrentuser est une fonction que sert juste a demander, qui est l'utilisateur
//actuelment connecte, et a recuperer ses infos, pour les afficher a l'ecran
export async function getCurrentUser(): Promise<User | null> {
    return mockUsers;
}
*/
import { mockAccounts, mockSession, mockUsers,} from "../mocks/workspace.mock";
import type { SignInInput, SignUpInput, User, } from "../types/workspace.types";
import { cloneMockValue, MockApiError, waitForMockApi, } from "./mock-api.utils";

export async function getCurrentUser(): Promise<User | null> {
  await waitForMockApi();
  if (!mockSession.currentUserId) {
    return null;
  }
  const user = mockUsers.find(({ id }) => id === mockSession.currentUserId,);
  if (!user) {
    mockSession.currentUserId = null;
    return null;
  }
  return cloneMockValue(user);
}

export async function signIn(input: SignInInput): Promise<User> {
  await waitForMockApi();
  const normalizedEmail = input.email.trim().toLowerCase();
  const user = mockUsers.find(({ email }) => email.toLowerCase() === normalizedEmail,);
  const account = user
      ? mockAccounts.find(({ userId }) => userId === user.id) : undefined;
  if (!user || !account || account.password !== input.password) {
    throw new MockApiError(401, "Invalid email or password.");
  }
  mockSession.currentUserId = user.id;
  return cloneMockValue(user);
}

export async function signUp(input: SignUpInput): Promise<User> {
  await waitForMockApi();
  const normalizedEmail = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();

  if (!normalizedEmail || !displayName || !input.password) {
    throw new MockApiError(400, "All sign-up fields are required.");
  }
  const emailAlreadyExists = mockUsers.some(({ email }) => email.toLowerCase() === normalizedEmail,);
  if (emailAlreadyExists) {
    throw new MockApiError(409, "An account already uses this email.");
  }
  const user: User = {
    id: `user-${mockUsers.length + 1}`,
    email: normalizedEmail,
    displayName,
  };
  mockUsers.push(user);
  mockAccounts.push({
    userId: user.id,
    password: input.password,
  });
  mockSession.currentUserId = user.id;
  return cloneMockValue(user);
}

export async function signOut(): Promise<void> {
  await waitForMockApi();
  mockSession.currentUserId = null;
}
