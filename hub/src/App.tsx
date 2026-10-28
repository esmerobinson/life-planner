import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { useShellToday } from "./ui/shellContext";
import { AppShell } from "./ui/AppShell";
import { NAV } from "./ui/areas";
import { AreaPage } from "./ui/AreaPage";
import { BackupPage } from "./ui/BackupPage";
import { GoalsPage } from "./ui/GoalsPage";
import { HomePage } from "./ui/HomePage";
import { InboxPage } from "./ui/InboxPage";
import { BinPage } from "./ui/BinPage";
import { SortPage } from "./ui/SortPage";
import { SyncPage } from "./ui/SyncPage";
import { TodayPanel } from "./ui/TodayPanel";
import { VisionPage } from "./ui/VisionPage";

function TodayRoute() {
  return <TodayPanel today={useShellToday()} />;
}

function HomeRoute() {
  return <HomePage today={useShellToday()} />;
}

function GoalsRoute() {
  return <GoalsPage today={useShellToday()} />;
}

/** Old goal links (/goals/<id>) open the goal in the side panel on the Goals page. */
function GoalDetailRoute() {
  const { id = "" } = useParams();
  return <Navigate to={`/goals?open=${encodeURIComponent(id)}`} replace />;
}

function AreaRoute() {
  return <AreaPage today={useShellToday()} />;
}

function InboxRoute() {
  return <InboxPage today={useShellToday()} />;
}

function SortRoute() {
  return <SortPage today={useShellToday()} />;
}

function BinRoute() {
  return <BinPage today={useShellToday()} />;
}

function BackupRoute() {
  return <BackupPage today={useShellToday()} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

/** Every route of the app (inside whichever router: the browser's, or a test's). */
export function AppRoutes() {
  return (
      <Routes>
        <Route element={<AppShell />}>
          {NAV.map((n) =>
            n.id === "home" ? (
              <Route key={n.id} path={n.path} element={<HomeRoute />} />
            ) : n.id === "today" ? (
              <Route key={n.id} path={n.path} element={<TodayRoute />} />
            ) : n.id === "vision" ? (
              <Route key={n.id} path={n.path} element={<VisionPage />} />
            ) : n.id === "goals" || n.path.startsWith("/area/") ? null : (
              <Route key={n.id} path={n.path} element={<h1>{n.label}</h1>} />
            ),
          )}
          <Route path="/goals" element={<GoalsRoute />} />
          <Route path="/goals/:id" element={<GoalDetailRoute />} />
          <Route path="/area/:areaId" element={<AreaRoute />} />
          <Route path="/inbox" element={<InboxRoute />} />
          <Route path="/inbox/sort" element={<SortRoute />} />
          <Route path="/bin" element={<BinRoute />} />
          <Route path="/backup" element={<BackupRoute />} />
          <Route path="/sync" element={<SyncPage />} />
        </Route>
      </Routes>
  );
}
