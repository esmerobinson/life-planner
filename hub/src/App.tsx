import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useShellToday } from "./ui/shellContext";
import { AppShell } from "./ui/AppShell";
import { NAV } from "./ui/areas";
import { InboxPage } from "./ui/InboxPage";
import { TodayPanel } from "./ui/TodayPanel";

function TodayRoute() {
  return <TodayPanel today={useShellToday()} />;
}

function InboxRoute() {
  return <InboxPage today={useShellToday()} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          {NAV.map((n) =>
            n.id === "today" ? (
              <Route key={n.id} path={n.path} element={<TodayRoute />} />
            ) : (
              <Route key={n.id} path={n.path} element={<h1>{n.label}</h1>} />
            ),
          )}
          <Route path="/inbox" element={<InboxRoute />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
