import { ReactNode } from "react";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page-wrapper">
      <div className="auth-card">
        {children}
      </div>
    </div>
  );
}