import { useAuthContext } from "../context/AuthContext";

/*
* Costume Hook declaration to pass read only information of Authentication Context
* exposes only: user, isLoading
*/

export function useCurrentUser() {
  const { user, isLoading } = useAuthContext();
  return { user, isLoading };
}