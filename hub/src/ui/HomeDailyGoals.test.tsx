import { screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { db } from "../data/db";
import {
  addSuggestedGoal, createItem, ensureCheckinSet, finishMorningPage, importExerciseCards, saveAnswer, saveExerciseMark, tickItem,
} from "../data/repo";
import type { JournalKey } from "../journal/crypto";
import { checkCardFile } from "../journal/exercise";
import { FAKE_CARD_FILE } from "../test/exerciseCards";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { renderApp } from "../test/renderApp";

// Her daily goals on Home (Esme, 2026-11-04: the green rows at the top of Home are the three
// Journal tasks only). "BPD practice every day" and "Journal daily" are not rows any more: they
// still count themselves from the journal (and linked to-dos), and show it on their card in
// the Goals column. Fictional data only.

const TODAY = "2026-11-02";
const OTHER = "e2e-pretend-other-device";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-goals-journal-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
});
afterEach(() => {
  vi.useRealTimers();
});

/** The goal's card in Home's Goals column. */
const card = async (title: string) =>
  within(await screen.findByRole("complementary", { name: "Goals this month" }))
    .findByRole("link", { name: title })
    .then((l) => l.closest("li")!);

/** The tick of a Journal row at the top of Today's list. */
const rowTick = async (title: string) =>
  within((await screen.findByRole("button", { name: title })).closest("li")!).getByRole("checkbox").getAttribute("aria-checked");

describe("BPD practice every day, on Home", () => {
  it("is a card in the Goals column, not a row; today's exercise card done counts today, with the streak", async () => {
    await confirmedDevice(db, jk);
    await importExerciseCards(jk, checkCardFile(FAKE_CARD_FILE)!, "2026-10-01");
    await addSuggestedGoal("suggested-bpd-practice", TODAY);
    await createItem({ kind: "task", title: "Pretend errand", areaId: "admin", priority: 2, due: TODAY }, TODAY);
    renderApp("/", TODAY);
    const c = await card("BPD practice every day");
    await vi.waitFor(() => expect(c).toHaveTextContent("0 / 30 this month"), { timeout: 5000 });
    expect(screen.queryByRole("button", { name: "BPD practice every day" })).toBeNull();

    await saveExerciseMark(jk, TODAY, OTHER, "day-1", true);
    await vi.waitFor(() => expect(c).toHaveTextContent("1 / 30 this month"), { timeout: 5000 });
    expect(within(c).getByTitle("1 day in a row")).toBeInTheDocument();
    await vi.waitFor(async () => expect(await rowTick("Mental health exercise")).toBe("true"), { timeout: 5000 });
  });

  it("a linked to-do ticked today counts too (no journal key needed)", async () => {
    await addSuggestedGoal("suggested-bpd-practice", TODAY);
    const t = await createItem({ kind: "task", title: "Read a pretend BPD article", areaId: "mind", priority: 2, goalId: "suggested-bpd-practice" }, TODAY);
    await tickItem(t.id, TODAY);
    renderApp("/", TODAY);
    const c = await card("BPD practice every day");
    await vi.waitFor(() => expect(within(c).getByTitle("1 day in a row")).toBeInTheDocument(), { timeout: 5000 });
  });
});

describe("Journal daily counts exactly the days the Journal rows tick (fix round 1, I1)", () => {
  const counted = async () => (await card("Journal daily")).textContent;

  it("a finished morning page counts today", async () => {
    await confirmedDevice(db, jk);
    await addSuggestedGoal("suggested-journal-daily", TODAY);
    await finishMorningPage(jk, TODAY, OTHER, "Pretend page");
    renderApp("/", TODAY);
    await vi.waitFor(async () => expect(await counted()).toMatch("1 / 30 this month"), { timeout: 5000 });
    // The row loads on its own read: wait for its tick rather than reading it at once.
    await vi.waitFor(async () => expect(await rowTick("Morning pages")).toBe("true"), { timeout: 5000 });
  });

  it("a half-typed autosave or a lone Skip doesn't count (the check-in isn't finished)", async () => {
    await confirmedDevice(db, jk);
    await addSuggestedGoal("suggested-journal-daily", TODAY);
    await ensureCheckinSet(jk, TODAY, ["K2", "K4"]);
    await saveAnswer(jk, TODAY, "K2", OTHER, "Two pretend words", false); // autosave while typing
    await saveAnswer(jk, TODAY, "K4", OTHER, null, true); // one Skip
    renderApp("/", TODAY);
    await vi.waitFor(async () => expect(await rowTick("Daily check-in")).toBe("false"), { timeout: 5000 });
    await vi.waitFor(async () => expect(await counted()).toMatch("0 / 30 this month"), { timeout: 5000 });
    expect(await rowTick("Morning pages")).toBe("false");
  });

  it("a finished check-in counts, as it ticks the Daily check-in row", async () => {
    await confirmedDevice(db, jk);
    await addSuggestedGoal("suggested-journal-daily", TODAY);
    await ensureCheckinSet(jk, TODAY, ["K2"]);
    await saveAnswer(jk, TODAY, "K2", OTHER, "A pretend answer", true);
    renderApp("/", TODAY);
    await vi.waitFor(async () => expect(await counted()).toMatch("1 / 30 this month"), { timeout: 5000 });
    expect(await rowTick("Daily check-in")).toBe("true");
  });

  it("today's exercise card done does NOT count: only morning pages and the check-in (Esme, 2026-11-02)", async () => {
    await confirmedDevice(db, jk);
    await importExerciseCards(jk, checkCardFile(FAKE_CARD_FILE)!, "2026-10-01");
    await addSuggestedGoal("suggested-journal-daily", TODAY);
    await saveExerciseMark(jk, TODAY, OTHER, "day-1", true);
    renderApp("/", TODAY);
    await vi.waitFor(async () => expect(await rowTick("Mental health exercise")).toBe("true"), { timeout: 5000 });
    await vi.waitFor(async () => expect(await counted()).toMatch("0 / 30 this month"), { timeout: 5000 });
  });

  it("while the journal is locked here it falls back to the rows' clear dates", async () => {
    await addSuggestedGoal("suggested-journal-daily", TODAY);
    // A row as another device sent it; no key on this device, so nothing is opened.
    await db.journal.put({ id: `page:${TODAY}:p1`, kind: "page", date: TODAY, fp: "0123456789abcdef", iv: "AAAAAAAAAAAAAAAA", ct: "AAAA" });
    renderApp("/", TODAY);
    await vi.waitFor(async () => expect(await counted()).toMatch("1 / 30 this month"), { timeout: 5000 });
  });
});

describe("the Goals page counts from the journal", () => {
  it("with the journal locked here, an exercise-counted goal shows its count as unknown, never as a low number (review M1)", async () => {
    await addSuggestedGoal("suggested-bpd-practice", TODAY);
    renderApp("/goals", TODAY);
    const tile = (await screen.findByRole("link", { name: "BPD practice every day" })).closest("li")!;
    expect(await within(tile).findByText("— / 30")).toBeInTheDocument();
    expect(within(tile).getByText(/Not available until the journal is unlocked/)).toBeInTheDocument();
  });

  it("Journal daily's tile counts the days with a page this month, and its streak", async () => {
    await confirmedDevice(db, jk);
    await addSuggestedGoal("suggested-journal-daily", TODAY);
    for (const d of ["2026-10-31", "2026-11-01", TODAY]) await finishMorningPage(jk, d, OTHER, "Pretend page");
    renderApp("/goals", TODAY);
    const tile = (await screen.findByRole("link", { name: "Journal daily" })).closest("li")!;
    expect(await within(tile).findByText("2 / 30")).toBeInTheDocument();
    expect(within(tile).getByText("Counts itself: morning pages or check-in")).toBeInTheDocument();
    expect(within(tile).getByTitle("3 days in a row")).toBeInTheDocument();
    expect(tile).toHaveClass("is-daily");
  });
});
