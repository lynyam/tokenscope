import { type ReactNode } from "react";
import { Sidebar } from "../components/Sidebar";
import { Toaster } from "../components/ui/sonner";
import { LegalLinks } from "../components/LegalLinks";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <Sidebar />
        <Toaster position="top-right" />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-3 sm:p-6">
          <div className="flex-1">{children}</div>

          <footer className="mt-10 shrink-0 border-t border-border pt-6 pb-2">
            <LegalLinks />
          </footer>
        </main>
      </div>
    </div>
  );
}