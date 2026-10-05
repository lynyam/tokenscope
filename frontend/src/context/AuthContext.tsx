import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AuthResponse, User, SignInInput, SignUpInput } from "../types/workspace.types";
import { getCurrentUser, signIn as apiSignIn, signUp as apiSignUp } from "../api/auth.api";
import { clearAuthSession, getAccessToken, saveAccessToken, subscribeToAuthInvalidation, } from "../api/auth-session";
import { getApiErrorMessage, isAbortError, } from "../api/http-client";
import { LegalLinks } from "../components/LegalLinks";


/**
 * AuthContextValue interface, creates an entire publicAPI
 * Any component can use,if it taps into AuthContext.
 */

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  signIn: (input: SignInInput) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>; //corrected the type of signUp to match the SignUpInput interface
  signOut: () => Promise<void>;
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
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Changing this counter retries startup verification.
  const [verificationAttempt, setVerificationAttempt] = useState(0);

  // Only the current attempt may update token/user state.
  const authAttempt = useRef(0);

  /* Section 1 */
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const attempt = ++authAttempt.current;
    const unsubscribe = subscribeToAuthInvalidation(() => {
      // A late startup response must not restore a user after a protected 401.
      // Logout and protected 401s invalidate any older pending result.
      authAttempt.current += 1;
      setUser(null);
      setSessionError(null);
      setIsLoading(false);
    });
    async function initializeSession() {
      setIsLoading(true);
      setSessionError(null);
      try {
        // Remove credentials and sessions left by development authentication.
        // Real sessions use the single key owned by auth-session.ts.
        for (const key of [
          "mockSession",
          "mockUsersData",
          "mockAccountsData",
          "tokenscope_access_token",
          "access_token", // Legacy organization-integration token; no longer consumed.
        ]) {
          localStorage.removeItem(key);
        }

        if (!getAccessToken()) {
          setUser(null);
          return;
        }
        const currentUser = await getCurrentUser(controller.signal);
        if (active && attempt === authAttempt.current) setUser(currentUser);
      } catch (error) {
        if (!active ||
          attempt !== authAttempt.current ||
          isAbortError(error)
        ) {
          return;
        }
        /*
         * A protected 401 already invokes the invalidation listener above.
         *
         * Other failures mean we could not verify the session.
         * Keep the token so the user can retry after connectivity recovers.
         */
        setUser(null);
        setSessionError(
          getApiErrorMessage(
            error,
            "Unable to verify your session. Please try again.",
          ),
        );
      } finally {
        if (active && attempt === authAttempt.current) setIsLoading(false);
      }
    }

    void initializeSession();
    return () => {
      active = false;
      authAttempt.current += 1;
      controller.abort();
      unsubscribe();
    };
  }, [verificationAttempt]);

  /*
   * Sign-in and sign-up share this completion rule.
   * Save the token only after confirming the attempt is still current.
   */
  async function authenticate(
    operation: () => Promise<AuthResponse>,
  ): Promise<void> {
    const attempt = ++authAttempt.current;
    const result = await operation();

    if (attempt !== authAttempt.current) {
      throw new DOMException(
        "Authentication attempt was superseded.",
        "AbortError",
      );
    }

    saveAccessToken(result.accessToken);
    setUser(result.user);
    setSessionError(null);
    setIsLoading(false);
  }

  /* Section 2 */
  function signIn(input: SignInInput): Promise<void> {
    return authenticate(() => apiSignIn(input));
  }

  function signUp(input: SignUpInput): Promise<void> {
    return authenticate(() => apiSignUp(input));
  }

  async function signOut(): Promise<void> {
    // M1 logout is local. The subscription above clears the React user.
    clearAuthSession();
  }

  /* Section 3 */
  return (
    <AuthContext.Provider value={{ user, isLoading, signIn,  signUp, signOut, }}>
      {sessionError ? (
        <section
          role="alert"
          className="flex min-h-screen flex-col items-center justify-center gap-4 p-6"
        >
          <h1 className="text-xl font-semibold">
            Unable to verify your session
          </h1>
          <p>{sessionError}</p>
                    <button
            type="button"
            className="rounded-lg border px-4 py-2"
            onClick={() => setVerificationAttempt(value => value + 1)}
          >
            Try again
          </button>
          <button
            type="button"
            className="rounded-lg border px-4 py-2"
            onClick={() => void signOut()}
          >
            Sign out
          </button>

          <LegalLinks className="mt-2" />
        </section>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}


/*
* Costume Hook declaration to pass al information and functionality of Authentication Context
* exposes everything: user, isLoading, signIn, signUp, signOut
*/
export function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return context;
}
