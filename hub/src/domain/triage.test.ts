import { describe, it, expect } from "vitest";
import { pickToday, CAPACITY, DUE_HORIZON, tickedOffToday, withTickedOff } from "./triage";
import type { Item, Goal } from "./types";

let n = 0;
function item(o: Partial<Item> = {}): Item {
  n += 1;
  return {
    id: `i${n}`,
    kind: "task",
    title: `task ${n}`,
    links: [],
    areaId: "writing",
    priority: 3,
    status: "open",
    createdAt: "2026-01-01",
    touchedAt: "2026-01-01",
    ...o,
  };
}
function goal(o: Partial<Goal> = {}): Goal {
  return {
    id: "g1",
    title: "goal",
    areaId: "writing",
    kind: "practice",
    milestones: [],
    createdAt: "2026-01-01",
    ...o,
  };
}
const ids = (xs: Item[]) => xs.map((x) => x.id);

// 2026-10-27 is a Tuesday; 2026-10-25 is a Sunday.
const TUE = "2026-10-27";
const WED = "2026-10-28";
const SUN = "2026-10-25";

describe("constants", () => {
  it("has the spec values", () => {
    expect(CAPACITY).toBe(4);
    expect(DUE_HORIZON).toBe(3);
  });
});

describe("pickToday", () => {
  it("recurring item appears only on its weekdays", () => {
    const r = item({ id: "r", recur: ["tue", "thu"] });
    expect(ids(pickToday([r], [], TUE, {}).rhythm)).toEqual(["r"]);
    expect(pickToday([r], [], WED, {}).rhythm).toEqual([]);
    expect(pickToday([r], [], TUE, {}).picks).toEqual([]);
  });

  it("recurring item on a non-matching day is in no list, even if p1 or due", () => {
    const p1 = item({ id: "r1", priority: 1, recur: ["thu"] });
    const dueR = item({ id: "r2", due: TUE, recur: ["thu"] });
    const out = pickToday([p1, dueR], [], TUE, {});
    expect(out).toEqual({ rhythm: [], picks: [], alsoDue: [] });
  });

  it("overdue and due within 3 days come first, ordered by due then priority", () => {
    const far = item({ id: "far", due: "2026-11-30", priority: 1 });
    const a = item({ id: "a", due: "2026-10-30", priority: 1 });
    const b = item({ id: "b", due: "2026-10-25", priority: 3 });
    const c = item({ id: "c", due: "2026-10-25", priority: 1 });
    const out = pickToday([far, a, b, c], [], TUE, {});
    expect(ids(out.picks).slice(0, 3)).toEqual(["c", "b", "a"]);
  });

  it("fills to 4 with p1 then rotates p2 by date", () => {
    const due = item({ id: "d", due: TUE });
    const p1 = item({ id: "p1", priority: 1 });
    const p2s = [1, 2, 3, 4].map((k) => item({ id: `q${k}`, priority: 2 }));
    const items = [due, p1, ...p2s];
    const day1 = pickToday(items, [], TUE, {});
    const day2 = pickToday(items, [], WED, {});
    expect(day1.picks).toHaveLength(CAPACITY);
    expect(ids(day1.picks).slice(0, 2)).toEqual(["d", "p1"]);
    expect(ids(day1.picks).slice(2)).not.toEqual(ids(day2.picks).slice(2));
  });

  it("seven overdue items: all seven on the list, never in the dropdown (Esme, 2026-11-06)", () => {
    const items = [1, 2, 3, 4, 5, 6, 7].map((k) => item({ id: `o${k}`, due: `2026-10-0${k}` }));
    const out = pickToday(items, [], TUE, {});
    expect(out.picks).toHaveLength(7);
    expect(out.alsoDue).toEqual([]);
  });

  it("due in the next few days fills the room left; the rest waits in the dropdown, none lost", () => {
    const soon = [1, 2, 3, 4, 5, 6].map((k) => item({ id: `s${k}`, due: k <= 3 ? "2026-10-28" : "2026-10-30" }));
    const out = pickToday(soon, [], TUE, {});
    expect(out.picks).toHaveLength(CAPACITY);
    expect(out.alsoDue).toHaveLength(2);
    expect(new Set([...ids(out.picks), ...ids(out.alsoDue)]).size).toBe(6);
  });

  it("a to-do added with today's due date is on the list even when it is already full (Esme, 2026-11-06)", () => {
    const pins = [1, 2, 3, 4].map((k) => item({ id: `pin${k}`, pinnedDate: TUE }));
    const added = item({ id: "added-today", due: TUE, priority: 3 });
    const out = pickToday([...pins, added], [], TUE, {});
    expect(ids(out.picks)).toContain("added-today");
    expect(out.alsoDue).toEqual([]);
  });

  it("pinned item is always included and counts toward the cap for things due later", () => {
    const pin = item({ id: "pin", pinnedDate: TUE, priority: 3 });
    const dues = [1, 2, 3, 4].map((k) => item({ id: `d${k}`, due: "2026-10-29" }));
    const out = pickToday([...dues, pin], [], TUE, {});
    expect(out.picks[0].id).toBe("pin");
    expect(out.picks).toHaveLength(4);
    expect(out.alsoDue).toHaveLength(1);
  });

  it("hiddenOn today removes an item, hiddenOn yesterday does not", () => {
    const h = item({ id: "h", due: TUE, hiddenOn: TUE });
    const y = item({ id: "y", due: TUE, hiddenOn: "2026-10-26" });
    expect(ids(pickToday([h, y], [], TUE, {}).picks)).toEqual(["y"]);
  });

  it("inbox items are picked only by their own day or deadline (bug #8)", () => {
    const items = [
      item({ id: "inbox-p1", areaId: "inbox", priority: 1 }),
      item({ id: "inbox-p2", areaId: "inbox", priority: 2 }),
      item({ id: "inbox-recur", areaId: "inbox", recur: ["tue"] }),
      item({ id: "inbox-due", areaId: "inbox", due: TUE }),
      item({ id: "inbox-pin", areaId: "inbox", pinnedDate: TUE }),
    ];
    const out = pickToday(items, [], TUE, {});
    expect(ids([...out.picks, ...out.alsoDue, ...out.rhythm])).toEqual(["inbox-pin", "inbox-due"]);
  });

  it("undated inbox, ideas, done and archived items never picked", () => {
    const items = [
      item({ id: "inbox", areaId: "inbox", priority: 1 }),
      item({ id: "idea", kind: "idea", due: TUE }),
      item({ id: "done", status: "done", due: TUE }),
      item({ id: "arch", status: "archived", due: TUE }),
      item({ id: "ok", due: TUE }),
    ];
    const out = pickToday(items, [], TUE, {});
    expect(ids([...out.picks, ...out.alsoDue, ...out.rhythm])).toEqual(["ok"]);
  });

  it("sunday is light, but overdue and due-today things still show", () => {
    const pin = item({ id: "pin", pinnedDate: SUN });
    const dues = [1, 2, 3].map((k) => item({ id: `d${k}`, due: `2026-10-0${k}` }));
    const soon = [1, 2, 3].map((k) => item({ id: `s${k}`, due: "2026-10-27" }));
    const p1 = item({ id: "p1", priority: 1 });
    const out = pickToday([pin, ...dues, ...soon, p1], [], SUN, {});
    expect(ids(out.picks)).toEqual(["pin", "d1", "d2", "d3"]);
    expect(ids(out.alsoDue)).toEqual(["s1", "s2", "s3"]);
    const light = pickToday([pin, ...soon, p1], [], SUN, {});
    expect(ids(light.picks)).toEqual(["pin", "s1", "s2"]);
    expect(ids(light.alsoDue)).toEqual(["s3"]);
  });

  it("empty input returns empty lists", () => {
    expect(pickToday([], [], TUE, {})).toEqual({ rhythm: [], picks: [], alsoDue: [] });
  });

  it("tie-break: goal behind monthly pace sorts first among equals", () => {
    const g1 = goal({ id: "ahead", monthlyTarget: 4 });
    const g2 = goal({ id: "behind", monthlyTarget: 4 });
    const a = item({ id: "a", priority: 1, goalId: "ahead" });
    const b = item({ id: "b", priority: 1, goalId: "behind" });
    const out = pickToday([a, b], [g1, g2], WED, { ahead: 4, behind: 0 });
    expect(ids(out.picks)).toEqual(["b", "a"]);
  });

  it("item pinned to tomorrow is not picked today, even if overdue", () => {
    const moved = item({ id: "moved", due: "2026-10-20", priority: 1, pinnedDate: WED });
    const p2 = item({ id: "p2later", priority: 2, pinnedDate: WED });
    const out = pickToday([moved, p2], [], TUE, {});
    expect(out.picks).toEqual([]);
    // and on the day it is pinned to, it is a pick
    expect(ids(pickToday([moved], [], WED, {}).picks)).toEqual(["moved"]);
  });

  it("item pinned to tomorrow is not in alsoDue", () => {
    const dues = [1, 2, 3, 4].map((k) => item({ id: `d${k}`, due: `2026-10-1${k}` }));
    const moved = item({ id: "moved", due: "2026-10-10", pinnedDate: WED });
    const out = pickToday([...dues, moved], [], TUE, {});
    expect(ids(out.picks)).toEqual(["d1", "d2", "d3", "d4"]);
    expect(out.alsoDue).toEqual([]);
  });
});

describe("Today keeps what was ticked off today (withTickedOff)", () => {
  const today = (items: Item[], day = TUE) => withTickedOff(pickToday(items, [], day, {}), items, day);

  it("a to-do completed today leaves the Today list and goes to doneToday; tomorrow it is gone", () => {
    const a = item({ id: "a", pinnedDate: TUE });
    const b = item({ id: "b", pinnedDate: TUE, status: "done", completedAt: TUE });
    const c = item({ id: "c", pinnedDate: TUE });
    const old = item({ id: "old", status: "done", completedAt: "2026-10-26" });
    const inbox = item({ id: "inbox", areaId: "inbox", status: "done", completedAt: TUE });
    const out = today([a, b, c, old, inbox]);
    expect(ids(out.picks)).toEqual(["a", "c"]);
    expect(ids(out.doneToday)).toEqual(["b"]);
    expect(today([a, b, c], WED).doneToday).toEqual([]);
  });

  it("a project finished today (status done) goes to doneToday too", () => {
    const p = item({ id: "p", status: "done", completedAt: TUE, sessions: [{ id: "s1", doneOn: TUE }] });
    const out = today([p]);
    expect(ids(out.picks)).toEqual([]);
    expect(ids(out.doneToday)).toEqual(["p"]);
  });

  it("a project with a session ticked today (not finished) stays in the picks, crossed off", () => {
    const p = item({ id: "p", sessions: [{ id: "s1", doneOn: TUE }, { id: "s2" }] });
    const out = today([p]);
    expect(ids(out.picks)).toEqual(["p"]);
    expect(out.doneToday).toEqual([]);
  });

  it("a habit done today never goes to doneToday", () => {
    const h = item({ id: "h", recur: ["tue"], doneDates: [TUE] });
    const out = today([h]);
    expect(ids(out.rhythm)).toEqual(["h"]);
    expect(out.doneToday).toEqual([]);
  });

  it("a habit done today stays in the rhythm, ticked ones last; tomorrow it is fresh", () => {
    const h1 = item({ id: "h1", recur: ["tue", "wed"], doneDates: [TUE] });
    const h2 = item({ id: "h2", recur: ["tue", "wed"] });
    expect(ids(today([h1, h2]).rhythm)).toEqual(["h2", "h1"]);
    expect(tickedOffToday(h1, TUE)).toBe(true);
    expect(ids(today([h1, h2], WED).rhythm)).toEqual(["h1", "h2"]);
    expect(tickedOffToday(h1, WED)).toBe(false);
  });

  it("a habit ticked on a day it is not planned for still shows, crossed off", () => {
    const h = item({ id: "h", recur: ["mon"], doneDates: [TUE] });
    expect(ids(today([h]).rhythm)).toEqual(["h"]);
    expect(ids(today([item({ id: "h0", recur: ["mon"] })]).rhythm)).toEqual([]);
  });
});

describe("project to-dos on Today", () => {
  const MON = "2026-11-02";
  const ids = (l: Item[]) => l.map((i) => i.id);
  const pick = (items: Item[]) => withTickedOff(pickToday(items, [], MON, {}), items, MON);

  it("shows when a session is planned for today", () => {
    const p = item({ id: "p", priority: 3, sessions: [{ id: "a", plannedFor: MON }, { id: "b" }] });
    expect(ids(pick([p]).picks)).toEqual(["p"]);
  });

  it("shows when the deadline is within the due horizon", () => {
    const p = item({ id: "p", priority: 3, due: "2026-11-05", sessions: [{ id: "a" }] });
    expect(ids(pick([p]).picks)).toEqual(["p"]);
  });

  it("does not fill Today by priority alone", () => {
    const p1 = item({ id: "p1", priority: 1, due: "2026-11-20", sessions: [{ id: "a" }] });
    const p2 = item({ id: "p2", priority: 2, sessions: [{ id: "a", plannedFor: "2026-11-04" }] });
    expect(ids(pick([p1, p2]).picks)).toEqual([]);
  });

  it("a session ticked today keeps it on Today, crossed out", () => {
    const p = item({ id: "p", priority: 3, due: "2026-11-20", sessions: [{ id: "a", doneOn: MON }, { id: "b" }] });
    expect(ids(pick([p]).picks)).toEqual(["p"]);
    expect(tickedOffToday(p, MON)).toBe(true);
    expect(tickedOffToday(p, "2026-11-03")).toBe(false);
  });

  it("not crossed out while another session is still planned for today (its box logs that one)", () => {
    const p = item({ id: "p", sessions: [{ id: "a", doneOn: MON }, { id: "b", plannedFor: MON }, { id: "c" }] });
    expect(tickedOffToday(p, MON)).toBe(false);
    expect(ids(pick([p]).picks)).toEqual(["p"]);
  });
});
