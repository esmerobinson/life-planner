import { addDays, weekdayOf } from "../domain/dates";
import type { ISODate, Item } from "../domain/types";
import { COLLECTION, STICKERS, STICKER_BY_KEY } from "./catalogue";
import { areasCleared, counters, derivedEarned, type EarningInput } from "./earning";
import { arrivedAt, repeatCount, stickerTotals } from "./world";

// Esme, 2026-11-04: "Full month" for EACH habit's first full month, and "Area cleared" every time
// an area's to-dos due in a month are all done by its end. One sticker each in the book; repeats
// show ×N. N is derived from the data (never stored), so two devices can't double count, and
// repeats never count towards the collection's 175.

const START = "2026-01-01";
let n = 0;
const task = (p: Partial<Item> = {}): Item => ({
  id: `r${++n}`, kind: "task", title: `Pretend ${n}`, links: [], areaId: "art", priority: 2, status: "open",
  createdAt: "2025-12-01", touchedAt: "2025-12-01", ...p,
});
const input = (p: Partial<EarningInput> = {}): EarningInput => ({
  start: START, today: "2026-06-15", items: [], goals: [], todayDone: [], journal: null, ...p,
});

function mondays(month: string): ISODate[] {
  const out: ISODate[] = [];
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) if (weekdayOf(d) === "mon") out.push(d);
  return out;
}
const fullHabit = (...months: string[]) => task({ recur: ["mon"], doneDates: months.flatMap(mondays) });

describe("Full month: each habit's first full month", () => {
  it("counts habits, not months: one habit with three full months is 1, three habits are 3", () => {
    expect(counters(input({ items: [fullHabit("2026-02", "2026-03", "2026-04")] })).get("habit-full-month")).toBe(1);
    const c = counters(input({ items: [fullHabit("2026-02"), fullHabit("2026-03"), fullHabit("2026-04", "2026-05")] }));
    expect(c.get("habit-full-month")).toBe(3);
    expect(repeatCount("full-month", c)).toBe(3);
    expect(derivedEarned(c).filter((k) => k === "full-month")).toHaveLength(1); // one sticker, shown ×3
  });

  it("80% isn't a full month", () => {
    const most = task({ recur: ["mon"], doneDates: mondays("2026-03").slice(1) }); // 4 of 5
    expect(counters(input({ items: [most] })).get("habit-full-month")).toBe(0);
  });
});

describe("Area cleared", () => {
  const due = (areaId: Item["areaId"], dueOn: ISODate, doneOn?: ISODate) =>
    task({ areaId, due: dueOn, ...(doneOn ? { status: "done" as const, completedAt: doneOn } : {}) });

  it.each([
    ["everything due in Art in February done by its end", [due("art", "2026-02-10", "2026-02-09"), due("art", "2026-02-27", "2026-02-28")], 1],
    ["one still open", [due("art", "2026-02-10", "2026-02-09"), due("art", "2026-02-27")], 0],
    ["one done only in March", [due("art", "2026-02-10", "2026-03-02")], 0],
    ["two areas in one month", [due("art", "2026-02-10", "2026-02-10"), due("body", "2026-02-12", "2026-02-12")], 2],
    ["one area in two months", [due("art", "2026-02-10", "2026-02-10"), due("art", "2026-03-10", "2026-03-10")], 2],
    ["a month not over yet doesn't count", [due("art", "2026-06-02", "2026-06-02")], 0],
    ["nothing due: nothing cleared", [task({ status: "done", completedAt: "2026-02-02" })], 0],
    ["planned (pinned) to-dos count too", [task({ pinnedDate: "2026-04-03", status: "done", completedAt: "2026-04-03" })], 1],
  ] as const)("%s", (_name, items, cleared) => {
    expect(areasCleared(items as unknown as Item[], START, "2026-06-15")).toBe(cleared);
  });

  it("is eight bonus stickers, one per area, each with its own ×N; outside the 175, but each counts once toward friends and hats", () => {
    const bonus = STICKERS.filter((s) => s.bonus);
    expect(bonus.map((s) => s.key)).toEqual(
      ["mind", "writing", "art", "content", "body", "tech", "production", "admin"].map((a) => `cleared-${a}`),
    );
    expect(bonus.every((s) => s.group === "bonus" && s.rule.at === 1)).toBe(true);
    expect(COLLECTION).toHaveLength(175);
    const items = [due("art", "2026-02-10", "2026-02-10"), due("art", "2026-03-10", "2026-03-10"), due("body", "2026-03-11", "2026-03-11")];
    const c = counters(input({ items }));
    const earned = derivedEarned(c);
    expect(earned).toEqual(expect.arrayContaining(["cleared-art", "cleared-body"]));
    expect(earned).not.toContain("cleared-mind");
    expect(repeatCount("cleared-art", c)).toBe(2);
    expect(repeatCount("cleared-body", c)).toBe(1);
    expect(STICKER_BY_KEY.get("cleared-art")?.name).toBe("Art: area cleared");
    const totals = stickerTotals(new Set(earned));
    expect(totals.collected).toBe(earned.length - 2); // the two Area cleared aren't in the 175
    expect(totals.friends).toBe(earned.length); // each counts once toward arrivals and hats (Esme: "once"), not ×2
    expect(arrivedAt(totals.friends, 1)).toEqual(arrivedAt(earned.length, 1));
  });

  it("is derived, so the same data on two devices gives the same count (no increments stored)", () => {
    const items = [due("admin", "2026-02-10", "2026-02-10")];
    expect(areasCleared(items, START, "2026-06-15")).toBe(areasCleared(items.map((i) => ({ ...i })), START, "2026-06-15"));
  });
});
