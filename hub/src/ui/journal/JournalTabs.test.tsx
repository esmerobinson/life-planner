import { screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { db } from "../../data/db";
import { renderApp } from "../../test/renderApp";
import { tabsFit } from "./useTabsFit";

// The Journal's big tabs never scroll sideways (journal v3): on the phone, and whenever they
// don't fit in one row, they stack as full-width rows. Fictional data only.

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

it("on the phone the tabs stack (full-width rows), every tab listed", async () => {
  setPhone(true);
  renderApp("/journal", "2026-11-04");
  const tabs = await nav();
  expect(tabs).toHaveClass("journal-tabs", "is-stacked");
  expect(within(tabs).getAllByRole("link").map((l) => l.querySelector(".journal-tab-label")?.textContent)).toEqual([
    "Mental health exercise", "Morning pages", "Daily check-in", "Read back",
  ]);
});

it("on a wide screen where they fit, they stay in a row", async () => {
  setPhone(false);
  renderApp("/journal", "2026-11-04");
  expect(await nav()).not.toHaveClass("is-stacked"); // jsdom measures nothing: everything fits
});

it("on a wide screen where they don't fit, they stack", async () => {
  setPhone(false);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 120 } as DOMRect);
  renderApp("/journal", "2026-11-04");
  expect(await nav()).toHaveClass("is-stacked");
});

describe("tabsFit", () => {
  it("adds each tab's natural width and the gaps between them", () => {
    expect(tabsFit([100, 100, 100], 8, 316)).toBe(true);
    expect(tabsFit([100, 100, 100], 8, 315)).toBe(false);
    expect(tabsFit([], 8, 0)).toBe(true);
  });
});
