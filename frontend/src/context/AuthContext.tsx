import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { User, SignInInput, SignUpInput } from "../types/workspace.types";
import { getCurrentUser, signIn as apiSignIn, signOut as apiSignOut, signUp as apiSignUp } from "../api/auth.api";
import { clearAuthSession, subscribeToAuthInvalidation } from "../api/auth-session";


/**
 * AuthContextValue interface, creates an entire publicAPI
 * Any component can use,if it taps into AuthContext.
 */

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  signIn: (input: SignInInput) => Promise<void>;
  signOut: () => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>; //corrected the type of signUp to match the SignUpInput interface
}

/* Creating the authentication context */
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

//miau
/**
 * AuthProvider function contains:
 * 1. Loading of a session if it already exists via useEffect hook
 * 2. Authentication functions: signIn, signOut, signUp
 * 3. Rendering of wrapper Authentication componet, irn return()
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const authAttempt = useRef(0);

  /* Section 1 */
  useEffect(() => {
    let active = true;
    const attempt = ++authAttempt.current;
    const unsubscribe = subscribeToAuthInvalidation(() => {
      // A late startup response must not restore a user after a protected 401.
      authAttempt.current += 1;
      setUser(null);
      setIsLoading(false);
    });
    async function initializeSession() {
      try {
        const currentUser = await getCurrentUser();
        if (active && attempt === authAttempt.current) setUser(currentUser);
      } catch (err) {
        if (active && attempt === authAttempt.current) setUser(null);
      } finally {
        if (active && attempt === authAttempt.current) setIsLoading(false);
      }
    }

    void initializeSession();
    return () => { active = false; unsubscribe(); };
  }, []);

  /* Section 2 */
  async function signIn(input: SignInInput) {
    const attempt = ++authAttempt.current;
    const loggedInUser = await apiSignIn(input);
    if (attempt === authAttempt.current) {
      setUser(loggedInUser);
      setIsLoading(false);
    }
  }

  async function signOut() {
    // Token/user cleanup is local in M1.
    clearAuthSession();
    await apiSignOut();
  }

  async function signUp(input: SignUpInput) {
    const attempt = ++authAttempt.current;
    const loggedInUser = await apiSignUp(input);
    if (attempt === authAttempt.current) {
      setUser(loggedInUser);
      setIsLoading(false);
    }
  }

  /* Section 3 */
  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut, signUp }}>
      {children}
    </AuthContext.Provider>
  );
}


/*
* Costume Hook declaration to pass al information and functionality of Authentication Context
* exposes everything: user, isLoading, signIn, signOut, signUp
*/
export function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return context;
}
