import { describe, it, expect } from "vitest";
import { pickToday, CAPACITY, DUE_HORIZON } from "./triage";
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

  it("seven overdue items: 4 picks, 3 alsoDue, none lost", () => {
    const items = [1, 2, 3, 4, 5, 6, 7].map((k) => item({ id: `o${k}`, due: `2026-10-0${k}` }));
    const out = pickToday(items, [], TUE, {});
    expect(out.picks).toHaveLength(4);
    expect(out.alsoDue).toHaveLength(3);
    expect(new Set([...ids(out.picks), ...ids(out.alsoDue)]).size).toBe(7);
  });

  it("pinned item is always included and counts toward the cap", () => {
    const pin = item({ id: "pin", pinnedDate: TUE, priority: 3 });
    const dues = [1, 2, 3, 4].map((k) => item({ id: `d${k}`, due: "2026-10-20" }));
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

  it("inbox, ideas, done and archived items never picked", () => {
    const items = [
      item({ id: "inbox", areaId: "inbox", due: TUE }),
      item({ id: "idea", kind: "idea", due: TUE }),
      item({ id: "done", status: "done", due: TUE }),
      item({ id: "arch", status: "archived", due: TUE }),
      item({ id: "ok", due: TUE }),
    ];
    const out = pickToday(items, [], TUE, {});
    expect(ids([...out.picks, ...out.alsoDue, ...out.rhythm])).toEqual(["ok"]);
  });

  it("sunday is light", () => {
    const pin = item({ id: "pin", pinnedDate: SUN });
    const dues = [1, 2, 3].map((k) => item({ id: `d${k}`, due: `2026-10-0${k}` }));
    const p1 = item({ id: "p1", priority: 1 });
    const out = pickToday([pin, ...dues, p1], [], SUN, {});
    expect(ids(out.picks)).toEqual(["pin", "d1", "d2"]);
    expect(ids(out.alsoDue)).toEqual(["d3"]);
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
});
