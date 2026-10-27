import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}
