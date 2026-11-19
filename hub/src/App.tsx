import { lazy, Suspense } from "react";
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
import { GameLoading } from "./rio/GameLoading";
// The game's styles stay in the main stylesheet, at the place they always had in it, so the cascade
// (and so the game's look) is exactly as before. Its code and art data are a separate chunk below.
import "./rio/menu/menu.css";
import "./rio/game-screen.css";

/**
 * Esme's Rio (/farm) is its own lazily loaded chunk: the game's code and its art data are most of
 * the app, and the main chunk has to stay under the service worker's 2 MB per-file precache limit
 * (vite.config.ts). Everything the other pages need (the farm's data and earning, the nook, the
 * pop-ins) stays in the main chunk. A chunk that fails to load: native/appUpdate.ts reloads once,
 * then the page's error guard (ui/AppShell.tsx) shows its problem note.
 */
const FarmPage = lazy(() => import("./farm/FarmPage").then((m) => ({ default: m.FarmPage })));
/** Development builds only (its route is too). */
const PopInDemo = import.meta.env.DEV ? lazy(() => import("./farm/FarmPage").then((m) => ({ default: m.PopInDemo }))) : () => null;

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
          {/* Home with the quick add open: the address of her home-screen "Add" bookmark (AppShell opens it). */}
          <Route path="/add" element={<HomeRoute />} />
          <Route path="/journal/:tab" element={<JournalRoute />} />
          <Route path="/goals" element={<GoalsRoute />} />
          <Route path="/goals/:id" element={<GoalDetailRoute />} />
          <Route path="/area/:areaId" element={<AreaRoute />} />
          <Route path="/inbox" element={<InboxRoute />} />
          <Route path="/inbox/sort" element={<SortRoute />} />
          <Route path="/bin" element={<BinRoute />} />
          <Route path="/backup" element={<BackupRoute />} />
          <Route path="/sync" element={<SyncPage />} />
          <Route path="/farm" element={<Suspense fallback={<GameLoading />}><FarmPage /></Suspense>} />
          {/* The monthly pop-in's demo: development builds only (review M8; StickerPopIn is unit-tested). */}
          {import.meta.env.DEV && <Route path="/farm/popin-demo" element={<Suspense fallback={null}><PopInDemo /></Suspense>} />}
          <Route path="/reminders" element={<RemindersPage />} />
          <Route path="/repeating" element={<RepeatingRoute />} />
        </Route>
      </Routes>
  );
}
