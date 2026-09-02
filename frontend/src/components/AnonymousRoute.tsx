import { Navigate } from "react-router-dom";
import { ReactNode } from "react";
import { useCurrentUser } from "../hooks/useCurrentUser";


export function AnonymousRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useCurrentUser();

  if (isLoading) {
    return <div>Loading...</div>;
  }
  
  if (user) {
    return <Navigate to="/organizations" replace />;
  }

  return <>{children}</>;
}