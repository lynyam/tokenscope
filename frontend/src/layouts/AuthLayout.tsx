import { type ReactNode } from "react";
import { LegalLinks } from "../components/LegalLinks";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-4">
      <div className="flex w-full items-center justify-center">
        {children}
      </div>

      <LegalLinks />
    </div>
  );
}
