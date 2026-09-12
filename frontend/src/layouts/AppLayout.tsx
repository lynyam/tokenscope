import { ReactNode } from "react";
import { Sidebar } from "../components/Sidebar";
import { Topbar } from "../components/Topbar";
import { Toaster } from "../components/ui/sonner"

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <Toaster position="top-right"/>
      <div className="main-area">
        <Topbar />
        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
}
