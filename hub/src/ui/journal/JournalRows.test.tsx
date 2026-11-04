import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";
import { HomePage } from "../HomePage";
import { db } from "../../data/db";
import { createItem, ensureCheckinSet, finishMorningPage, importExerciseCards, saveAnswer, saveExerciseMark } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { checkCardFile } from "../../journal/exercise";
import { FAKE_CARD_FILE } from "../../test/exerciseCards";
import { confirmedDevice, keyFor, verifierRow } from "../../test/journalKey";
import { currentUrl, renderApp } from "../../test/renderApp";
import { LOADING, NOT_AVAILABLE, ReadOnlyTick, TICKS_ITSELF } from "./JournalStrip";

// The Journal rows (VISUAL-LANGUAGE.md "Journal rows (2026-11-02)"; Journal v2): three mint
// strips (the exercise first) on Home, on Today and in Mind's Habits, whose ticks tick
// themselves, with the shared streak; tapping one opens its Journal tab, and the tabs tick
// too. Fictional passphrase, words and cards only.

const PASS = "fake-journal-passphrase-for-tests";
const TODAY = "2026-11-02";
const OTHER_DEVICE = "e2e-pretend-other-device";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor(PASS);
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function JournalAt() {
  const l = useLocation();
  return <p>{`At ${l.pathname}${l.hash}`}</p>;
}

/** Home alone, with /journal showing where it landed (path and hash). */
function renderHomeWithJournalSpy() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<HomePage today={TODAY} />} />
        <Route path="/journal/:tab" element={<JournalAt />} />
      </Routes>
    </MemoryRouter>,
  );
}

const card = () => screen.findByRole("region", { name: "Journal" });
const row = async (title: string) => (await screen.findByRole("button", { name: title })).closest("li")!;
const tick = (el: HTMLElement) => within(el).getByRole("checkbox");

/** Morning pages today and the two days before; check-in finished yesterday only; exercise done today. */
async function someDone() {
  await confirmedDevice(db, jk);
  for (const d of ["2026-10-31", "2026-11-01", TODAY]) await finishMorningPage(jk, d, OTHER_DEVICE, "Pretend page");
  await ensureCheckinSet(jk, "2026-11-01", ["K2"]);
  await saveAnswer(jk, "2026-11-01", "K2", OTHER_DEVICE, "Pretend answer", true);
  await ensureCheckinSet(jk, TODAY, ["K2", "K4"]);
  await saveAnswer(jk, TODAY, "K2", OTHER_DEVICE, "Pretend half way", true); // K4 not reached yet
  await importExerciseCards(jk, checkCardFile(FAKE_CARD_FILE)!, "2026-10-01");
  await saveExerciseMark(jk, TODAY, OTHER_DEVICE, "day-1", true);
}

describe("the read-only tick's states", () => {
  it("done: a checked, disabled checkbox showing the ✓ glyph", () => {
    render(<ReadOnlyTick state="done" title="Morning pages" />);
    const box = screen.getByRole("checkbox", { name: "Morning pages done today" });
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(box).toHaveClass("tick-auto", "is-done");
    expect(box).toHaveTextContent("✓");
  });

  it("not done yet: an unchecked, disabled checkbox with no glyph", () => {
    render(<ReadOnlyTick state="todo" title="Morning pages" />);
    const box = screen.getByRole("checkbox", { name: "Morning pages done today" });
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(box).toHaveTextContent("");
  });

  it("locked: no checkbox (never a false 'not done'); the empty box says why", () => {
    render(<ReadOnlyTick state="locked" title="Morning pages" />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    const box = screen.getByRole("img", { name: NOT_AVAILABLE });
    expect(box).toHaveClass("tick-auto");
    expect(box).toHaveAttribute("title", NOT_AVAILABLE);
  });

  it("loading: no box at all yet (so nothing pops from unticked to ticked), only its space", () => {
    render(<ReadOnlyTick state="loading" title="Morning pages" />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    const space = screen.getByRole("img", { name: LOADING });
    expect(space).toHaveClass("tick-auto-space");
    expect(space).not.toHaveClass("tick-auto");
  });
});

describe("Home Journal rows", () => {
  it("locked (not set up here): three mint strips, no ticks, no streaks, nothing written", async () => {
    await db.journal.put(await verifierRow(jk));
    const before = await db.journal.toArray();
    renderApp("/", TODAY);
    const c = await card();
    const titles = ["Mental health exercise", "Morning pages", "Daily check-in"];
    for (const t of titles) {
      const r = await row(t);
      expect(r).toHaveClass("strip", "journal-row");
      // Not "not done": unknown. No checkbox at all, just the empty box, labelled as such.
      await waitFor(() => expect(within(r).getByRole("img", { name: NOT_AVAILABLE })).toHaveClass("tick-auto"));
      expect(within(r).queryByRole("checkbox")).toBeNull();
    }
    expect(within(c).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(c).getAllByRole("listitem").map((li) => within(li).getByRole("button").textContent)).toEqual(titles);
    expect(c.querySelector(".streak")).toBeNull();
    expect(c.querySelectorAll(".strip-meta")).toHaveLength(0);
    expect(await db.journal.toArray()).toEqual(before);
  });

  it("the tick is read-only: not focusable, aria-disabled, says it ticks itself; clicking it never writes", async () => {
    await someDone();
    renderApp("/", TODAY);
    const r = await row("Daily check-in");
    const box = await within(r).findByRole("checkbox"); // once known (no box while loading)
    expect(box).toHaveAttribute("aria-disabled", "true");
    expect(box).toHaveAttribute("title", TICKS_ITSELF);
    expect(box).not.toHaveAttribute("tabindex");
    expect(box.tagName).not.toBe("INPUT");
    const before = await db.journal.count();
    await userEvent.click(box);
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(await db.journal.count()).toBe(before);
    // Tabbing goes to the row's title, never the box.
    expect(document.activeElement).not.toBe(box);
  });

  it("done today ticks itself with the streak; not done yet keeps yesterday's run; the exercise shows today's card", async () => {
    await someDone();
    renderApp("/", TODAY);
    const morning = await row("Morning pages");
    await waitFor(() => expect(tick(morning)).toHaveAttribute("aria-checked", "true"));
    expect(within(morning).getByText("3 days in a row")).toBeInTheDocument();
    // The shared streak: this week's bars (the last three days done) and the number; no star.
    const bars = [...morning.querySelectorAll(".streak .streak-day")].map((b) => b.classList.contains("on"));
    expect(bars).toEqual([false, false, false, false, true, true, true]);
    expect(morning.querySelector(".streak-n")).toHaveTextContent("3");
    expect(morning.querySelector(".journal-star")).toBeNull();
    expect(morning.querySelector(".strip-meta")).toBeNull();

    const checkin = await row("Daily check-in");
    expect(tick(checkin)).toHaveAttribute("aria-checked", "false"); // half way through today
    expect(within(checkin).getByText("1 day in a row")).toBeInTheDocument();

    const exercise = await row("Mental health exercise");
    expect(tick(exercise)).toHaveAttribute("aria-checked", "true");
    expect(within(exercise).getByText("1 day in a row")).toBeInTheDocument();
    expect(within(exercise).getByText("Day 1 · Pretend weather")).toHaveClass("strip-meta");
  });

  it("a streak of 0 with nothing this week shows nothing", async () => {
    await confirmedDevice(db, jk);
    await finishMorningPage(jk, "2026-10-20", OTHER_DEVICE, "Pretend old page");
    renderApp("/", TODAY);
    const morning = await row("Morning pages");
    await waitFor(() => expect(screen.getByRole("region", { name: "Journal" })).toBeInTheDocument());
    expect(morning.querySelector(".streak")).toBeNull();
    expect(await within(morning).findByRole("checkbox")).toHaveAttribute("aria-checked", "false");
  });

  it("a streak of 0 still shows this week's bars when a day this week was done", async () => {
    await confirmedDevice(db, jk);
    await finishMorningPage(jk, "2026-10-29", OTHER_DEVICE, "Pretend page");
    renderApp("/", TODAY);
    const morning = await row("Morning pages");
    await waitFor(() => expect(morning.querySelector(".streak")).not.toBeNull());
    expect(morning.querySelector(".streak-n")).toHaveTextContent("0");
    expect(morning.querySelectorAll(".streak-day.on")).toHaveLength(1);
  });

  it.each([
    ["Mental health exercise", "/journal/exercise"],
    ["Morning pages", "/journal/morning"],
    ["Daily check-in", "/journal/check-in"],
  ])("tapping %s opens its Journal tab", async (title, path) => {
    renderHomeWithJournalSpy();
    await userEvent.click(await screen.findByRole("button", { name: title }));
    expect(await screen.findByText(`At ${path}`)).toBeInTheDocument();
  });

  it("tapping the strip outside its title (here the tick box) opens the section too", async () => {
    await someDone();
    renderHomeWithJournalSpy();
    const r = await row("Mental health exercise");
    await waitFor(() => expect(tick(r)).toHaveAttribute("aria-checked", "true"));
    await userEvent.click(tick(r));
    expect(await screen.findByText("At /journal/exercise")).toBeInTheDocument();
  });

  it("locked: tapping a row goes to the Journal, which asks to unlock", async () => {
    renderApp("/", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Daily check-in" }));
    await waitFor(() => expect(currentUrl).toBe("/journal/check-in"));
    expect(await screen.findByRole("heading", { name: "Unlock journal" })).toBeInTheDocument();
  });
});

describe("Today: a Journal section under the to-dos", () => {
  it("the same three rows, after the Today list", async () => {
    await someDone();
    renderApp("/today", TODAY);
    const c = await card();
    const today = screen.getByRole("heading", { level: 1, name: "Today" });
    expect(today.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(c).getAllByRole("listitem").map((li) => within(li).getByRole("button").textContent)).toEqual([
      "Mental health exercise", "Morning pages", "Daily check-in",
    ]);
    const morning = await row("Morning pages");
    await waitFor(() => expect(tick(morning)).toHaveAttribute("aria-checked", "true"));
    await userEvent.click(within(c).getByRole("button", { name: "Daily check-in" }));
    await waitFor(() => expect(currentUrl).toBe("/journal/check-in"));
  });
});

describe("Mind's Habits box holds the Journal rows", () => {
  it("after her own Mind habits, in the habit format: 'every day', 'November · session N of 30', read-only ticks", async () => {
    await someDone();
    await createItem({ kind: "task", title: "Pretend habit", areaId: "mind", priority: 2, recur: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] }, TODAY);
    renderApp("/area/mind", TODAY);
    const box = await screen.findByRole("list", { name: "Habits" });
    await waitFor(() => expect(within(box).getAllByRole("listitem")).toHaveLength(4));
    const items = within(box).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector(".strip-title")!.textContent)).toEqual([
      expect.stringContaining("Pretend habit"), "Mental health exercise", "Morning pages", "Daily check-in",
    ]);
    const morning = items[2]!;
    expect(morning).toHaveClass("journal-row");
    expect(within(morning).getByText("every day")).toHaveClass("strip-meta");
    await waitFor(() => expect(within(morning).getByText("November · session 2 of 30")).toBeInTheDocument());
    expect(tick(morning)).toHaveAttribute("aria-checked", "true");
    expect(tick(morning)).toHaveAttribute("aria-disabled", "true");
    expect(within(items[3]!).getByText("November · session 1 of 30")).toBeInTheDocument(); // checked in on the 1st
    await userEvent.click(within(morning).getByRole("button", { name: "Morning pages" }));
    await waitFor(() => expect(currentUrl).toBe("/journal/morning"));
  });

  it("with no Mind habits the box still shows, with the three rows; other areas don't get them", async () => {
    await confirmedDevice(db, jk);
    const first = renderApp("/area/mind", TODAY);
    const box = await screen.findByRole("list", { name: "Habits" });
    expect(within(box).getAllByRole("listitem")).toHaveLength(3);
    first.unmount();
    renderApp("/area/writing", TODAY);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "Morning pages" })).toBeNull();
  });
});

describe("Journal tabs", () => {
  const tabs = () => screen.findByRole("navigation", { name: "Journal parts" });

  it("big tabs in her order, the exercise first; /journal opens it; each part done today shows its tick and streak", async () => {
    await someDone();
    renderApp("/journal", TODAY);
    await waitFor(() => expect(currentUrl).toBe("/journal/exercise"));
    const nav = await tabs();
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/journal/exercise", "/journal/morning", "/journal/check-in", "/journal/read-back", "/journal/notes"]);
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(links[0]).toHaveClass("journal-tab", "is-selected");
    await waitFor(() => expect(links[1]!.querySelector(".tick-auto.is-done")).not.toBeNull());
    expect(links[1]).toHaveTextContent("(done today)");
    expect(links[0]!.querySelector(".tick-auto.is-done")).not.toBeNull();
    expect(links[2]!.querySelector(".tick-auto.is-done")).toBeNull(); // half way through today
    expect(links[2]!.querySelector(".tick-auto")).not.toBeNull();
    expect(links[3]!.querySelector(".tick-auto")).toBeNull(); // Read back has no tick
    expect(links[4]!.querySelector(".tick-auto, .tick-auto-space, .streak")).toBeNull(); // nor Notes to myself
    expect(within(links[1]!).getByText("3 days in a row")).toBeInTheDocument();
    expect(nav.querySelector(".journal-star")).toBeNull();
  });

  it("finishing today's check-in ticks its tab by itself", async () => {
    await someDone();
    renderApp("/journal/check-in", TODAY);
    const nav = await tabs();
    const link = within(nav).getByRole("link", { name: /Daily check-in/ });
    const panel = await screen.findByRole("region", { name: "Daily check-in" }, { timeout: 5000 });
    await userEvent.click(await within(panel).findByRole("button", { name: "Finish" }));
    await waitFor(() => expect(link.querySelector(".tick-auto.is-done")).not.toBeNull());
    expect(within(link).getByText("2 days in a row")).toBeInTheDocument();
  });

  it("tapping a tab changes the address and the part shown", async () => {
    await confirmedDevice(db, jk);
    renderApp("/journal/exercise", TODAY);
    await userEvent.click(within(await tabs()).getByRole("link", { name: /Morning pages/ }));
    await waitFor(() => expect(currentUrl).toBe("/journal/morning"));
    expect(await screen.findByLabelText("Today's morning page", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it.each([
    ["#morning-pages", "/journal/morning"],
    ["#daily-check-in", "/journal/check-in"],
    ["#mental-health-exercise", "/journal/exercise"],
  ])("an earlier link /journal%s opens %s", async (hash, path) => {
    renderApp(`/journal${hash}`, TODAY);
    await waitFor(() => expect(currentUrl).toBe(path));
  });
});
