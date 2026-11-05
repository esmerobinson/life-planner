import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
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
import { RemindersPage } from "./ui/RemindersPage";
import { RepeatingPage } from "./ui/RepeatingPage";
import { VisionPage } from "./ui/VisionPage";
import { JournalPage } from "./ui/journal/JournalPage";
import { FarmPage, PopInDemo } from "./farm/FarmPage";

/**
 * There is no Today page (Esme, 2026-11-04: "today page is a little redundant with the
 * existence of home"): old /today links and notifications open Home, keeping what they asked
 * for (?open=<id>, a #hash).
 */
function TodayRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: "/", search, hash }} replace />;
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

function JournalRoute() {
  return <JournalPage today={useShellToday()} />;
}

function RepeatingRoute() {
  return <RepeatingPage today={useShellToday()} />;
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
            ) : n.id === "vision" ? (
              <Route key={n.id} path={n.path} element={<VisionPage />} />
            ) : n.id === "journal" ? (
              <Route key={n.id} path={n.path} element={<JournalRoute />} />
            ) : n.id === "goals" || n.id === "farm" || n.path.startsWith("/area/") ? null : (
              <Route key={n.id} path={n.path} element={<h1>{n.label}</h1>} />
            ),
          )}
          <Route path="/today" element={<TodayRedirect />} />
          <Route path="/journal/:tab" element={<JournalRoute />} />
          <Route path="/goals" element={<GoalsRoute />} />
          <Route path="/goals/:id" element={<GoalDetailRoute />} />
          <Route path="/area/:areaId" element={<AreaRoute />} />
          <Route path="/inbox" element={<InboxRoute />} />
          <Route path="/inbox/sort" element={<SortRoute />} />
          <Route path="/bin" element={<BinRoute />} />
          <Route path="/backup" element={<BackupRoute />} />
          <Route path="/sync" element={<SyncPage />} />
          <Route path="/farm" element={<FarmPage />} />
          {/* The monthly pop-in's demo: development builds only (review M8; StickerPopIn is unit-tested). */}
          {import.meta.env.DEV && <Route path="/farm/popin-demo" element={<PopInDemo />} />}
          <Route path="/reminders" element={<RemindersPage />} />
          <Route path="/repeating" element={<RepeatingRoute />} />
        </Route>
      </Routes>
  );
}
