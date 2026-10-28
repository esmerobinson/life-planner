import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useShellToday } from "./ui/shellContext";
import { AppShell } from "./ui/AppShell";
import { NAV } from "./ui/areas";
import { AreaPage } from "./ui/AreaPage";
import { BackupPage } from "./ui/BackupPage";
import { GoalDetail } from "./ui/GoalDetail";
import { GoalsPage } from "./ui/GoalsPage";
import { HomePage } from "./ui/HomePage";
import { InboxPage } from "./ui/InboxPage";
import { TodayPanel } from "./ui/TodayPanel";

function TodayRoute() {
  return <TodayPanel today={useShellToday()} />;
}

function HomeRoute() {
  return <HomePage today={useShellToday()} />;
}

function GoalsRoute() {
  return <GoalsPage today={useShellToday()} />;
}

function GoalDetailRoute() {
  return <GoalDetail today={useShellToday()} />;
}

function AreaRoute() {
  return <AreaPage today={useShellToday()} />;
}

function InboxRoute() {
  return <InboxPage today={useShellToday()} />;
}

function BackupRoute() {
  return <BackupPage today={useShellToday()} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          {NAV.map((n) =>
            n.id === "home" ? (
              <Route key={n.id} path={n.path} element={<HomeRoute />} />
            ) : n.id === "today" ? (
              <Route key={n.id} path={n.path} element={<TodayRoute />} />
            ) : n.id === "goals" || n.path.startsWith("/area/") ? null : (
              <Route key={n.id} path={n.path} element={<h1>{n.label}</h1>} />
            ),
          )}
          <Route path="/goals" element={<GoalsRoute />} />
          <Route path="/goals/:id" element={<GoalDetailRoute />} />
          <Route path="/area/:areaId" element={<AreaRoute />} />
          <Route path="/inbox" element={<InboxRoute />} />
          <Route path="/backup" element={<BackupRoute />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
