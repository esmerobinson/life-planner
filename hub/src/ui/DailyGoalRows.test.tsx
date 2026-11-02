import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import {
  addSuggestedGoal, createGoal, createItem, finishMorningPage, importExerciseCards, saveExerciseMark, tickItem,
} from "../data/repo";
import type { JournalKey } from "../journal/crypto";
import { checkCardFile } from "../journal/exercise";
import { FAKE_CARD_FILE } from "../test/exerciseCards";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { currentUrl, renderApp } from "../test/renderApp";

// Daily goals on Home / Today (goals-redesign-brief.md): a mint row at the top of Today for
// each active daily goal chosen for Home. Fictional data only.

const TODAY = "2026-11-02";
const OTHER = "e2e-pretend-other-device";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-goals-journal-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
});

const dailyRows = () => screen.findByRole("list", { name: "Daily goals" });

describe("the BPD practice row", () => {
  it("sits at the top of Today, mint, with a read-only tick that ticks when today's exercise card is done", async () => {
    await confirmedDevice(db, jk);
    await importExerciseCards(jk, checkCardFile(FAKE_CARD_FILE)!, "2026-10-01");
    await addSuggestedGoal("suggested-bpd-practice", TODAY);
    await createItem({ kind: "task", title: "Pretend errand", areaId: "admin", priority: 2, due: TODAY }, TODAY);
    renderApp("/today", TODAY);
    const list = await dailyRows();
    const row = within(list).getByRole("button", { name: "BPD practice every day" }).closest("li")!;
    expect(row).toHaveClass("strip", "journal-row");
    // Above the to-dos.
    const errand = await screen.findByText("Pretend errand");
    expect(list.compareDocumentPosition(errand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const box = await within(row).findByRole("checkbox", { name: "BPD practice every day done today" });
    expect(box).toHaveAttribute("aria-disabled", "true");
    expect(box).toHaveAttribute("aria-checked", "false");
    await userEvent.click(box);
    expect(await db.goals.get("suggested-bpd-practice")).not.toHaveProperty("monthGoals.0.log");

    await saveExerciseMark(jk, TODAY, OTHER, "day-1", true);
    await vi.waitFor(() =>
      expect(within(row).getByRole("checkbox", { name: "BPD practice every day done today" })).toHaveAttribute("aria-checked", "true"),
    );
    expect(within(row).getByTitle("1 day in a row")).toBeInTheDocument();
  });

  it("a linked to-do ticked today counts too (no journal key needed)", async () => {
    await addSuggestedGoal("suggested-bpd-practice", TODAY);
    const t = await createItem({ kind: "task", title: "Read a pretend BPD article", areaId: "mind", priority: 2, goalId: "suggested-bpd-practice" }, TODAY);
    await tickItem(t.id, TODAY);
    renderApp("/today", TODAY);
    const list = await dailyRows();
    await vi.waitFor(() =>
      expect(within(list).getByRole("checkbox", { name: "BPD practice every day done today" })).toHaveAttribute("aria-checked", "true"),
    );
  });

  it("tapping the row opens the goal", async () => {
    await addSuggestedGoal("suggested-bpd-practice", TODAY);
    renderApp("/today", TODAY);
    await userEvent.click(within(await dailyRows()).getByRole("button", { name: "BPD practice every day" }));
    expect(await screen.findByRole("complementary", { name: "BPD practice every day" })).toBeInTheDocument();
    expect(currentUrl).toBe("/today?open=suggested-bpd-practice");
  });

  it("only active daily goals chosen for Home get a row", async () => {
    await addSuggestedGoal("suggested-bpd-practice", TODAY);
    await addSuggestedGoal("suggested-mental-health", TODAY); // not daily
    await createGoal({ title: "Pretend daily off Home", areaId: "body", kind: "practice", rhythm: "daily" }, TODAY);
    await createGoal({ title: "Pretend resting daily", areaId: "body", kind: "practice", rhythm: "daily", onHome: true, active: false }, TODAY);
    renderApp("/today", TODAY);
    const list = await dailyRows();
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });

  it("Journal daily ticks from a morning page's clear date", async () => {
    await confirmedDevice(db, jk);
    await addSuggestedGoal("suggested-journal-daily", TODAY);
    await finishMorningPage(jk, TODAY, OTHER, "Pretend page");
    renderApp("/today", TODAY);
    const list = await dailyRows();
    await vi.waitFor(() =>
      expect(within(list).getByRole("checkbox", { name: "Journal daily done today" })).toHaveAttribute("aria-checked", "true"),
    );
  });
});

describe("a daily goal without automatic sources", () => {
  it("has a normal tick that logs today on its count (and unticks)", async () => {
    const g = await createGoal({
      title: "Pretend stretch", areaId: "body", kind: "practice", rhythm: "daily", onHome: true,
      monthGoals: [{ id: "m", month: "2026-11", kind: "count", title: "Days stretched", target: 30 }],
    }, TODAY);
    renderApp("/today", TODAY);
    const box = within(await dailyRows()).getByRole("checkbox", { name: "Pretend stretch done today" });
    expect(box).not.toHaveAttribute("aria-disabled");
    await userEvent.click(box);
    await vi.waitFor(async () => expect((await db.goals.get(g.id))!.monthGoals![0]!.log).toEqual([TODAY]));
    await vi.waitFor(() => expect(within(screen.getByRole("list", { name: "Daily goals" })).getByRole("checkbox")).toHaveAttribute("aria-checked", "true"));
    await userEvent.click(within(screen.getByRole("list", { name: "Daily goals" })).getByRole("checkbox"));
    await vi.waitFor(async () => expect((await db.goals.get(g.id))!.monthGoals![0]!.log).toBeUndefined());
  });
});

describe("the Goals page counts from the journal", () => {
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
