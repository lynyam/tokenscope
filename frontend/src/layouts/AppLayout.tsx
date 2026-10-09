import { type ReactNode } from "react";
import { Sidebar } from "../components/Sidebar";
import { Toaster } from "../components/ui/sonner";
import { LegalLinks } from "../components/LegalLinks";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <Toaster position="top-right" />

        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          {children}

          <footer className="mt-10 border-t border-border pt-6 pb-2">
            <LegalLinks />
          </footer>
        </main>
      </div>
    </div>
  );
}