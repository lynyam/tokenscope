import { ReactNode } from "react";
import { Sidebar } from "../components/Sidebar";
import { Topbar } from "../components/Topbar";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <Topbar />
      <Sidebar />
      <div className="main-area">
        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
}
