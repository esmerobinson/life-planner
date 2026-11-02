import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";
import { HomePage } from "../HomePage";
import { db } from "../../data/db";
import { ensureCheckinSet, finishMorningPage, importExerciseCards, saveAnswer, saveExerciseMark } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { checkCardFile } from "../../journal/exercise";
import { FAKE_CARD_FILE } from "../../test/exerciseCards";
import { confirmedDevice, keyFor, verifierRow } from "../../test/journalKey";
import { currentUrl, renderApp } from "../../test/renderApp";
import { LOADING, NOT_AVAILABLE, ReadOnlyTick, TICKS_ITSELF } from "./JournalStrip";

// The Journal rows (VISUAL-LANGUAGE.md "Journal rows (2026-11-02)"): three mint strips on Home
// whose ticks tick themselves, with "★ N" streaks, and the same strips heading the Journal's
// sections. Fictional passphrase, words and cards only.

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
        <Route path="/journal" element={<JournalAt />} />
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
  await saveExerciseMark(jk, TODAY, OTHER_DEVICE, 1, true);
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
    const titles = ["Morning pages", "Daily check-in", "Mental health exercise"];
    for (const t of titles) {
      const r = await row(t);
      expect(r).toHaveClass("strip", "journal-row");
      // Not "not done": unknown. No checkbox at all, just the empty box, labelled as such.
      await waitFor(() => expect(within(r).getByRole("img", { name: NOT_AVAILABLE })).toHaveClass("tick-auto"));
      expect(within(r).queryByRole("checkbox")).toBeNull();
    }
    expect(within(c).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(c).getAllByRole("listitem")).toHaveLength(3);
    expect(c.querySelector(".journal-row-streak")).toBeNull();
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

  it("done today ticks itself with ★ N; not done yet keeps yesterday's run; the exercise shows today's card", async () => {
    await someDone();
    renderApp("/", TODAY);
    const morning = await row("Morning pages");
    await waitFor(() => expect(tick(morning)).toHaveAttribute("aria-checked", "true"));
    expect(within(morning).getByText("3 days in a row")).toBeInTheDocument();
    expect(morning.querySelector(".journal-star")).not.toBeNull();
    expect(morning.querySelector(".strip-meta")).toBeNull();

    const checkin = await row("Daily check-in");
    expect(tick(checkin)).toHaveAttribute("aria-checked", "false"); // half way through today
    expect(within(checkin).getByText("1 day in a row")).toBeInTheDocument();

    const exercise = await row("Mental health exercise");
    expect(tick(exercise)).toHaveAttribute("aria-checked", "true");
    expect(within(exercise).getByText("1 day in a row")).toBeInTheDocument();
    expect(within(exercise).getByText("Day 1 · Pretend weather")).toHaveClass("strip-meta");
  });

  it("a streak of 0 shows nothing", async () => {
    await confirmedDevice(db, jk);
    await finishMorningPage(jk, "2026-10-20", OTHER_DEVICE, "Pretend old page");
    renderApp("/", TODAY);
    const morning = await row("Morning pages");
    await waitFor(() => expect(screen.getByRole("region", { name: "Journal" })).toBeInTheDocument());
    expect(morning.querySelector(".journal-row-streak")).toBeNull();
    expect(await within(morning).findByRole("checkbox")).toHaveAttribute("aria-checked", "false");
  });

  it.each([
    ["Morning pages", "#morning-pages"],
    ["Daily check-in", "#daily-check-in"],
    ["Mental health exercise", "#mental-health-exercise"],
  ])("tapping %s opens its Journal section", async (title, hash) => {
    renderHomeWithJournalSpy();
    await userEvent.click(await screen.findByRole("button", { name: title }));
    expect(await screen.findByText(`At /journal${hash}`)).toBeInTheDocument();
  });

  it("tapping the strip outside its title (here the tick box) opens the section too", async () => {
    await someDone();
    renderHomeWithJournalSpy();
    const r = await row("Mental health exercise");
    await waitFor(() => expect(tick(r)).toHaveAttribute("aria-checked", "true"));
    await userEvent.click(tick(r));
    expect(await screen.findByText("At /journal#mental-health-exercise")).toBeInTheDocument();
  });

  it("locked: tapping a row goes to the Journal, which asks to unlock", async () => {
    renderApp("/", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Daily check-in" }));
    await waitFor(() => expect(currentUrl).toBe("/journal"));
    expect(await screen.findByRole("heading", { name: "Unlock journal" })).toBeInTheDocument();
  });
});

describe("Journal page section strips", () => {
  it("each section starts with its mint strip: the h2 labels the section, tick and ★ N as on Home", async () => {
    await someDone();
    renderApp("/journal", TODAY);
    const morning = await screen.findByRole("region", { name: "Morning pages" }, { timeout: 5000 });
    const head = within(morning).getByRole("heading", { level: 2, name: "Morning pages" }).closest(".strip")!;
    expect(head).toHaveClass("journal-row");
    expect(morning.firstElementChild).toBe(head);
    await waitFor(() => expect(within(head as HTMLElement).getByRole("checkbox")).toHaveAttribute("aria-checked", "true"));
    expect(within(head as HTMLElement).getByText("3 days in a row")).toBeInTheDocument();

    const checkin = screen.getByRole("region", { name: "Daily check-in" });
    const checkHead = within(checkin).getByRole("heading", { level: 2, name: "Daily check-in" }).closest(".strip") as HTMLElement;
    await waitFor(() => expect(within(checkHead).getByText("1 day in a row")).toBeInTheDocument());
    expect(within(checkHead).getByRole("checkbox")).toHaveAttribute("aria-checked", "false");

    const exercise = screen.getByRole("region", { name: "Mental health exercise" });
    const exHead = within(exercise).getByRole("heading", { level: 2, name: "Mental health exercise" }).closest(".strip") as HTMLElement;
    await waitFor(() => expect(within(exHead).getByRole("checkbox")).toHaveAttribute("aria-checked", "true"));
    expect(within(exHead).getByRole("checkbox")).toHaveAttribute("aria-disabled", "true");
  });

  it("finishing today's check-in ticks its strip by itself", async () => {
    await someDone();
    renderApp("/journal", TODAY);
    const checkin = await screen.findByRole("region", { name: "Daily check-in" }, { timeout: 5000 });
    const head = within(checkin).getByRole("heading", { level: 2, name: "Daily check-in" }).closest(".strip") as HTMLElement;
    await userEvent.click(await within(checkin).findByRole("button", { name: "Finish" }));
    await waitFor(() => expect(within(head).getByRole("checkbox")).toHaveAttribute("aria-checked", "true"));
    expect(within(head).getByText("2 days in a row")).toBeInTheDocument();
  });
});
