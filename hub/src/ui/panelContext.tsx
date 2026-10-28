import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useLocation, useNavigate, type To } from "react-router-dom";

/** The URL parameter naming the open item or goal (`?open=<id>`), so Back closes the panel. */
export const OPEN_PARAM = "open";

export interface Panel {
  /** The id in the URL, or null. */
  openId: string | null;
  /** Opens (or swaps to) an item or goal. */
  open: (id: string) => void;
  /** Closes the panel: Back when this app opened it, else the same page without it. */
  close: () => void;
  /** A link target that opens `id` on the current page. */
  href: (id: string) => To;
}

const PanelContext = createContext<Panel | null>(null);

/** The side panel's controls; null outside the app shell (pages then show plain titles). */
export function usePanel(): Panel | null {
  return useContext(PanelContext);
}

/**
 * Opening pushes one history entry (marked in its state) so Back closes the panel; swapping
 * to another item replaces it, so Back still closes rather than stepping through items.
 */
export function PanelProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const openId = params.get(OPEN_PARAM) || null;
  const pushed = (location.state as { panel?: boolean } | null)?.panel === true;

  const searchWith = useCallback(
    (id: string | null) => {
      const p = new URLSearchParams(location.search);
      if (id === null) p.delete(OPEN_PARAM);
      else p.set(OPEN_PARAM, id);
      const s = p.toString();
      return s ? `?${s}` : "";
    },
    [location.search],
  );

  const open = useCallback(
    (id: string) => {
      if (id === openId) return;
      const to = { pathname: location.pathname, search: searchWith(id) };
      if (openId) navigate(to, { replace: true, state: location.state });
      else navigate(to, { state: { panel: true } });
    },
    [openId, location.pathname, location.state, navigate, searchWith],
  );

  const close = useCallback(() => {
    if (!openId) return;
    if (pushed) navigate(-1);
    else navigate({ pathname: location.pathname, search: searchWith(null) }, { replace: true });
  }, [openId, pushed, navigate, location.pathname, searchWith]);

  const href = useCallback((id: string): To => ({ pathname: location.pathname, search: searchWith(id) }), [
    location.pathname,
    searchWith,
  ]);

  const value = useMemo(() => ({ openId, open, close, href }), [openId, open, close, href]);
  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}
