import { screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { db } from "../../data/db";
import { renderApp } from "../../test/renderApp";

// The Journal's big tabs never scroll sideways (journal v3): on the phone they stack as
// full-width rows (2026-11-04); on the Mac they sit in one row across (VISUAL-LANGUAGE.md "Full,
// no blank space (2026-11-05)", pick 4 · A), which journal.css lays out (a narrow Mac window
// stacks them there too). Fictional data only.

beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.syncMeta.clear()]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
}

const nav = () => screen.findByRole("navigation", { name: "Journal parts" });

it("on the phone the tabs stack (full-width rows), every tab listed, Notes to myself last", async () => {
  setPhone(true);
  renderApp("/journal", "2026-11-04");
  const tabs = await nav();
  expect(tabs).toHaveClass("journal-tabs", "is-stacked");
  expect(within(tabs).getAllByRole("link").map((l) => l.querySelector(".journal-tab-label")?.textContent)).toEqual([
    "Mental health exercise", "Morning pages", "Daily check-in", "Read back", "Notes to myself",
  ]);
});

it("on the Mac they are one row, even where their one-line widths wouldn't fit (labels wrap inside their tab)", async () => {
  setPhone(false);
  // Before 2026-11-05 a row this narrow for tabs this wide stacked them; nothing is measured now.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 120 } as DOMRect);
  renderApp("/journal", "2026-11-04");
  const tabs = await nav();
  expect(tabs).toHaveClass("journal-tabs");
  expect(tabs).not.toHaveClass("is-stacked");
  // The room journal.css's container query measures the row against.
  expect(tabs.parentElement).toHaveClass("journal-tabs-room");
});
