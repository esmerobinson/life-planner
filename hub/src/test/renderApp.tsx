import { render } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { AppRoutes } from "../App";

/** The current URL, for tests (path + search). */
export let currentUrl = "";

function Spy() {
  const l = useLocation();
  currentUrl = l.pathname + l.search;
  return null;
}

/**
 * Renders the whole app (shell, routes, side panel) at `path`, with the clock fixed to
 * midday on `today`. Call `vi.useRealTimers()` in afterEach.
 */
export function renderApp(path: string | string[], today = "2026-10-28") {
  const [y, m, d] = today.split("-").map(Number);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(y, m - 1, d, 12, 0));
  return render(
    <MemoryRouter initialEntries={Array.isArray(path) ? path : [path]}>
      <AppRoutes />
      <Spy />
    </MemoryRouter>,
  );
}
