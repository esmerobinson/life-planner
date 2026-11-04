import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import {
  addMonthGoal, addSuggestedGoal, createGoal, deleteGoal, listJournalledDays, minusOne, planMonth, plusOne,
  removeMonthGoal, saveGoalNotes, setGoalActive, setMonthStep, updateGoal, undoMonthEdits, updateMonthGoal,
} from "./repo";
import { validGoal } from "./validate";
import { SUGGESTED_GOALS } from "../domain/suggestedGoals";

const TODAY = "2026-11-02";

beforeEach(async () => {
  await Promise.all([db.goals.clear(), db.items.clear(), db.journal.clear()]);
});

const practice = () => createGoal({ title: "Pretend goal", areaId: "writing", kind: "practice" }, TODAY);
const stored = async (id: string) => (await db.goals.get(id))!;

describe("Active / Inactive", () => {
  it("inactive is stored as active: false; active again removes the field", async () => {
    const g = await practice();
    await setGoalActive(g.id, false);
    expect((await stored(g.id)).active).toBe(false);
    await setGoalActive(g.id, true);
    expect("active" in (await stored(g.id))).toBe(false);
  });
});

describe("monthly goals", () => {
  it("adds a count (with a target) and a step for this month; the row stays valid", async () => {
    const g = await practice();
    await addMonthGoal(g.id, { kind: "count", title: " Writing sessions ", target: 20 }, TODAY);
    await addMonthGoal(g.id, { kind: "step", title: "Send chapter 3" }, TODAY);
    const row = await stored(g.id);
    expect(row.monthGoals).toEqual([
      { id: expect.any(String), month: "2026-11", kind: "count", title: "Writing sessions", target: 20 },
      { id: expect.any(String), month: "2026-11", kind: "step", title: "Send chapter 3" },
    ]);
    expect(validGoal(row)).toBe(true);
  });

  it("refuses a blank title or a count without a whole target", async () => {
    const g = await practice();
    await expect(addMonthGoal(g.id, { kind: "step", title: "  " }, TODAY)).rejects.toThrow();
    await expect(addMonthGoal(g.id, { kind: "count", title: "x" }, TODAY)).rejects.toThrow();
    await expect(addMonthGoal(g.id, { kind: "count", title: "x", target: 1.5 }, TODAY)).rejects.toThrow();
    expect((await stored(g.id)).monthGoals).toBeUndefined();
  });

  it("+1 logs today; −1 undoes the last; steps tick and untick", async () => {
    const g = await practice();
    const c = await addMonthGoal(g.id, { kind: "count", title: "Sessions", target: 3 }, TODAY);
    const s = await addMonthGoal(g.id, { kind: "step", title: "Step" }, TODAY);
    await plusOne(g.id, c, "2026-11-01");
    await plusOne(g.id, c, TODAY);
    expect((await stored(g.id)).monthGoals![0]!.log).toEqual(["2026-11-01", TODAY]);
    await minusOne(g.id, c);
    await minusOne(g.id, c);
    expect((await stored(g.id)).monthGoals![0]!.log).toBeUndefined();
    await setMonthStep(g.id, s, true);
    expect((await stored(g.id)).monthGoals![1]!.done).toBe(true);
    await setMonthStep(g.id, s, false);
    expect("done" in (await stored(g.id)).monthGoals![1]!).toBe(false);
  });

  it("a daily goal's +1 counts today once (review M4)", async () => {
    const g = await createGoal({ title: "Pretend daily", areaId: "body", kind: "practice", rhythm: "daily" }, TODAY);
    const c = await addMonthGoal(g.id, { kind: "count", title: "Days", target: 30 }, TODAY);
    await plusOne(g.id, c, TODAY);
    await plusOne(g.id, c, TODAY);
    expect((await stored(g.id)).monthGoals![0]!.log).toEqual([TODAY]);
  });

  it("edits and removes; removing the last drops the field", async () => {
    const g = await practice();
    const c = await addMonthGoal(g.id, { kind: "count", title: "Sessions", target: 3 }, TODAY);
    await updateMonthGoal(g.id, c, { title: "Long sessions", target: 8 });
    expect((await stored(g.id)).monthGoals![0]).toMatchObject({ title: "Long sessions", target: 8 });
    await removeMonthGoal(g.id, c);
    expect("monthGoals" in (await stored(g.id))).toBe(false);
  });

  describe("undoMonthEdits (Edit's Cancel: only this session's own changes)", () => {
    it("undoes a rename, a new target, a removal (in place) and an add; keeps a tick made since", async () => {
      const g = await practice();
      const a = await addMonthGoal(g.id, { kind: "count", title: "Sessions", target: 3 }, TODAY);
      const b = await addMonthGoal(g.id, { kind: "step", title: "Book a pretend class" }, TODAY);
      const c = await addMonthGoal(g.id, { kind: "step", title: "Third" }, TODAY);
      const before = (await stored(g.id)).monthGoals!;
      await updateMonthGoal(g.id, a, { title: "Renamed", target: 9 });
      await removeMonthGoal(g.id, b);
      const added = await addMonthGoal(g.id, { kind: "step", title: "Added in Edit" }, TODAY);
      await plusOne(g.id, a, TODAY);
      await undoMonthEdits(g.id, [
        { kind: "retitle", id: a, from: "Sessions", to: "Renamed" },
        { kind: "retarget", id: a, from: 3, to: 9 },
        { kind: "remove", entry: before[1]!, index: 1 },
        { kind: "add", id: added },
      ]);
      const now = (await stored(g.id)).monthGoals!;
      expect(now.map((m) => m.id)).toEqual([a, b, c]);
      expect(now[0]).toMatchObject({ title: "Sessions", target: 3, log: [TODAY] });
      expect(now[1]).toEqual(before[1]);
      expect(validGoal(await stored(g.id))).toBe(true);
    });

    it("a chain of renames goes back to the first title", async () => {
      const g = await practice();
      const a = await addMonthGoal(g.id, { kind: "step", title: "One" }, TODAY);
      await updateMonthGoal(g.id, a, { title: "Two" });
      await updateMonthGoal(g.id, a, { title: "Three" });
      await undoMonthEdits(g.id, [
        { kind: "retitle", id: a, from: "One", to: "Two" },
        { kind: "retitle", id: a, from: "Two", to: "Three" },
      ]);
      expect((await stored(g.id)).monthGoals![0]!.title).toBe("One");
    });

    it("leaves what arrived by sync: a remote rename, target and removal survive a Cancel", async () => {
      const g = await practice();
      const a = await addMonthGoal(g.id, { kind: "count", title: "Sessions", target: 3 }, TODAY);
      const b = await addMonthGoal(g.id, { kind: "step", title: "Book" }, TODAY);
      const c = await addMonthGoal(g.id, { kind: "step", title: "Third" }, TODAY);
      // This session renamed a, retargeted a, removed b and c.
      await updateMonthGoal(g.id, a, { title: "Mine", target: 4 });
      const mid = (await stored(g.id)).monthGoals!;
      await removeMonthGoal(g.id, b);
      // Meanwhile the other device changed a's title and target, and re-added b.
      const row = await stored(g.id);
      await db.goals.put({
        ...row,
        monthGoals: [{ ...mid[0]!, title: "Theirs", target: 7 }, mid[1]!, ...row.monthGoals!.filter((m) => m.id === c)],
      });
      const synced = await stored(g.id);
      await undoMonthEdits(g.id, [
        { kind: "retitle", id: a, from: "Sessions", to: "Mine" },
        { kind: "retarget", id: a, from: 3, to: 4 },
        { kind: "remove", entry: mid[1]!, index: 1 },
      ]);
      const now = (await stored(g.id)).monthGoals!;
      expect(now[0]).toMatchObject({ title: "Theirs", target: 7 }); // not put back
      expect(now.filter((m) => m.id === b)).toHaveLength(1); // present again already: not duplicated
      expect(now).toEqual(synced.monthGoals);
    });

    it("no edits, or nothing to undo, writes nothing", async () => {
      const g = await practice();
      const a = await addMonthGoal(g.id, { kind: "step", title: "Same" }, TODAY);
      const row = await stored(g.id);
      await undoMonthEdits(g.id, []);
      await undoMonthEdits(g.id, [{ kind: "retitle", id: a, from: "Other", to: "Gone" }]);
      expect(await stored(g.id)).toEqual(row);
    });
  });

  it("a binned goal can't be changed", async () => {
    const g = await practice();
    await deleteGoal(g.id, TODAY);
    await expect(addMonthGoal(g.id, { kind: "step", title: "x" }, TODAY)).rejects.toThrow();
  });

  it("Plan November copies October's counts (not steps); a second tap adds nothing", async () => {
    const g = await practice();
    await addMonthGoal(g.id, { kind: "count", title: "Writing sessions", target: 20 }, "2026-10-05");
    await addMonthGoal(g.id, { kind: "step", title: "Send chapter 3" }, "2026-10-05");
    await planMonth(g.id, "2026-11-01");
    await planMonth(g.id, "2026-11-01");
    const nov = (await stored(g.id)).monthGoals!.filter((m) => m.month === "2026-11");
    expect(nov).toEqual([{ id: expect.any(String), month: "2026-11", kind: "count", title: "Writing sessions", target: 20 }]);
  });
});

describe("updateGoal: daily and counts from", () => {
  it("daily makes it a practice without a deadline; finite takes daily off", async () => {
    const g = await createGoal({ title: "Pretend", areaId: "art", kind: "finite", deadline: "2026-12-31" }, TODAY);
    await updateGoal(g.id, { rhythm: "daily" }, TODAY);
    expect(await stored(g.id)).toMatchObject({ rhythm: "daily", kind: "practice" });
    expect((await stored(g.id)).deadline).toBeUndefined();
    await updateGoal(g.id, { kind: "finite", deadline: "2027-01-31" }, TODAY);
    expect((await stored(g.id)).rhythm).toBeUndefined();
  });

  it("countsFrom is saved without repeats; an empty list removes it", async () => {
    const g = await practice();
    await updateGoal(g.id, { countsFrom: ["journal", { area: "mind" }, { area: "mind" }] }, TODAY);
    expect((await stored(g.id)).countsFrom).toEqual(["journal", { area: "mind" }]);
    await updateGoal(g.id, { countsFrom: [] }, TODAY);
    expect("countsFrom" in (await stored(g.id))).toBe(false);
  });
});

describe("Suggested goals", () => {
  it("each is added only on a tap, with its own fixed id, set up to count itself", async () => {
    expect(await db.goals.count()).toBe(0);
    await addSuggestedGoal("suggested-bpd-practice", TODAY);
    const bpd = await stored("suggested-bpd-practice");
    expect(bpd).toMatchObject({
      title: "BPD practice every day", areaId: "mind", kind: "practice", rhythm: "daily", onHome: true,
      countsFrom: ["exercise", "linked"],
      monthGoals: [{ month: "2026-11", kind: "count", title: "Days practised", target: 30 }],
    });
    expect(validGoal(bpd)).toBe(true);
    await addSuggestedGoal("suggested-mental-health", TODAY);
    expect(await stored("suggested-mental-health")).toMatchObject({
      title: "Improve my mental health", countsFrom: ["exercise", { area: "mind" }],
      monthGoals: [{ kind: "count", title: "Mind things done", target: 30 }],
    });
    expect((await stored("suggested-mental-health")).onHome).toBeUndefined();
    expect((await stored("suggested-mental-health")).rhythm).toBeUndefined();
    await addSuggestedGoal("suggested-journal-daily", TODAY);
    expect(await stored("suggested-journal-daily")).toMatchObject({
      title: "Journal daily", areaId: "mind", rhythm: "daily", countsFrom: ["journal"], onHome: true,
      monthGoals: [{ title: "Days journalled", target: 30 }],
    });
    expect(SUGGESTED_GOALS).toHaveLength(3);
  });

  it("a second tap changes nothing; one in the Bin is restored with its history and notes (review M2)", async () => {
    await addSuggestedGoal("suggested-journal-daily", TODAY);
    await setGoalActive("suggested-journal-daily", false);
    await addSuggestedGoal("suggested-journal-daily", TODAY);
    expect((await stored("suggested-journal-daily")).active).toBe(false);
    await plusOne("suggested-journal-daily", "suggested-journal-daily-2026-11", TODAY);
    await saveGoalNotes("suggested-journal-daily", "Pretend notes");
    await deleteGoal("suggested-journal-daily", TODAY);
    await addSuggestedGoal("suggested-journal-daily", TODAY);
    const back = await stored("suggested-journal-daily");
    expect(back.status).toBeUndefined();
    expect(back.deletedAt).toBeUndefined();
    expect(back.notes).toBe("Pretend notes");
    expect(back.monthGoals![0]!.log).toEqual([TODAY]);
  });

  it("an emptied (purged) one comes back fresh", async () => {
    await db.goals.put({ id: "suggested-journal-daily", title: "", areaId: "mind", kind: "practice", milestones: [], createdAt: "2026-01-01", status: "purged" });
    await addSuggestedGoal("suggested-journal-daily", TODAY);
    expect(await stored("suggested-journal-daily")).toMatchObject({ title: "Journal daily", monthGoals: [{ title: "Days journalled" }] });
    expect((await stored("suggested-journal-daily")).status).toBeUndefined();
  });
});

describe("listJournalledDays", () => {
  it("counts page, photo and answer rows by their clear date; drafts and exercise rows don't count", async () => {
    const row = (id: string, kind: string, date: string) => ({ id, kind, date, fp: "0123456789abcdef", iv: "AAAAAAAAAAAAAAAA", ct: "AAAA" });
    // Written straight to the table (not through the tracker's validator path): only clear fields are read.
    await db.journal.bulkPut([
      row("page:2026-11-01:a", "page", "2026-11-01"),
      row("photo:2026-10-31:f", "photo", "2026-10-31"),
      row("answer:2026-10-30:p", "answer", "2026-10-30"),
      row("draft:2026-10-29:d", "draft", "2026-10-29"),
      row("exercise:2026-10-28:d", "exercise", "2026-10-28"),
    ] as never);
    expect([...(await listJournalledDays())].sort()).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
  });
});
