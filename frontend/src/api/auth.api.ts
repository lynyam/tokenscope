import { User } from '../types/workspace.types'
import { mockUser } from '../mocks/workspace.mock'

//getcurrentuser est une fonction que sert juste a demander, qui est l'utilisateur
//actuelment connecte, et a recuperer ses infos, pour les afficher a l'ecran
// export async function getCurrentUser(): Promise<User> {
//     return mockUser;
// } 


/**
 * function getCurrentUser, retrieves current user from local storage
 * value is stored under the key mock session
 */
export async function getCurrentUser(): Promise<User | null> {
    const stored = localStorage.getItem("mockSession");
  return stored ? JSON.parse(stored) : null;
}


/**
 *  sign in function that simulates backend call
 *  local storage: browser provided storage mechanism
 */

export async function signIn(email: string, password: string): Promise<User> {
  await new Promise((res) => setTimeout(res, 300)); // simulate network delay
  localStorage.setItem("mockSession", JSON.stringify(mockUser));
  return mockUser;
}


/**
 * TODO: verify duplication verification is added 
 */
export async function signUp(email: string, password: string): Promise<User> {
  await new Promise((res) => setTimeout(res, 300)); // simulate network delay
  localStorage.setItem("mockSession", JSON.stringify(mockUser));
  return mockUser;
}




/**
 * sign in function that simulates backend call
 * removes current signed in user 
 */
export async function signOut(): Promise<void> {
  localStorage.removeItem("mockSession");
}



//TODO: decide which version of getCurrentUser() stays
//TODO: decide if signIn*) and signOut() stays
