import { Link, useLocation, useNavigate } from "react-router-dom";
import { NAV } from "./areas";

/** Pages whose title the phone top bar shows (the page's own h1 is then kept for screen readers only). */
const TITLES: Record<string, string> = {
  ...Object.fromEntries(NAV.filter((n) => n.path !== "/").map((n) => [n.path, n.label])),
  "/inbox": "Inbox",
  "/backup": "Backup",
  "/sync": "Sync",
  "/bin": "Bin",
};

/**
 * The top-bar title for a path, or null for pages that show their own heading (an open
 * goal, and any page not listed): those get the back arrow and an empty title, as the
 * mockup's open-task screen does.
 */
export function phoneTitle(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return TITLES[path] ?? null;
}

/**
 * Phone top bar (mockup-phone.html tab A): on Home, "Esmeworld" and the Inbox pill; on
 * every other page, a round back arrow, the page title and the Inbox pill. Back goes to
 * the previous page in this app's history, or Home when the app was opened on this page.
 */
export function PhoneTopBar({ inboxLabel }: { inboxLabel: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const home = location.pathname === "/";
  const title = phoneTitle(location.pathname);

  return (
    <header className="phone-top">
      {!home && (
        <button
          type="button"
          className="phone-back"
          aria-label="Back"
          // "default" is the router's key for the first page this app was opened on. Going
          // Home then replaces it, so the system swipe-back does not return here.
          onClick={() => (location.key === "default" ? navigate("/", { replace: true }) : navigate(-1))}
        >
          ←
        </button>
      )}
      {home ? (
        <h1 className="phone-title">Esmeworld</h1>
      ) : (
        // The page's own h1 carries the name for screen readers; this is the visible copy.
        <p className="phone-title" aria-hidden="true">
          {title ?? ""}
        </p>
      )}
      <Link to="/inbox" className="btn-secondary shell-inbox">
        {inboxLabel}
      </Link>
    </header>
  );
}
