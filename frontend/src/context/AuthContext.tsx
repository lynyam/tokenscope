import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, SignInInput, SignUpInput } from "../types/workspace.types";
import { getCurrentUser, signIn as apiSignIn, signOut as apiSignOut, signUp as apiSignUp } from "../api/auth.api";


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

  /* Section 1 */
  useEffect(() => {
    getCurrentUser().then((currentUser) => {
      setUser(currentUser);
      setIsLoading(false);
    });
  }, []);

  /* Section 2 */
  async function signIn(input: SignInInput) {
    const loggedInUser = await apiSignIn(input);
    setUser(loggedInUser);
  }

  async function signOut() {
    await apiSignOut();
    setUser(null);
  }

  async function signUp(input: SignUpInput) {
  const loggedInUser = await apiSignUp(input);
  setUser(loggedInUser);
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