import { describe, expect, it } from "vitest";
import { DUE_SOON_DAYS, STALE_DAYS, needsALook } from "./attention";
import type { Item } from "./types";

const TODAY = "2026-10-27";
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
    createdAt: "2026-10-27",
    touchedAt: "2026-10-27",
    ...o,
  };
}
const ids = (xs: Item[]) => xs.map((i) => i.id);

describe("needsALook", () => {
  it("exposes the two thresholds", () => {
    expect(DUE_SOON_DAYS).toBe(3);
    expect(STALE_DAYS).toBe(14);
  });

  it("due yesterday is overdue; today, +3 are due soon; +4 is nothing", () => {
    const y = item({ due: "2026-10-26" });
    const t = item({ due: "2026-10-27" });
    const p3 = item({ due: "2026-10-30" });
    const p4 = item({ due: "2026-10-31" });
    const r = needsALook([y, t, p3, p4], TODAY);
    expect(ids(r.overdue)).toEqual([y.id]);
    expect(ids(r.dueSoon)).toEqual([t.id, p3.id]);
    expect(r.stale).toEqual([]);
  });

  it("stale at exactly 14 days, not at 13", () => {
    const at14 = item({ touchedAt: "2026-10-13" });
    const at13 = item({ touchedAt: "2026-10-14" });
    const r = needsALook([at14, at13], TODAY);
    expect(ids(r.stale)).toEqual([at14.id]);
  });

  it("sorts: overdue oldest first, due soon by due, stale most stale first", () => {
    const o1 = item({ due: "2026-10-20" });
    const o2 = item({ due: "2026-10-10" });
    const d1 = item({ due: "2026-10-29" });
    const d2 = item({ due: "2026-10-28" });
    const s1 = item({ touchedAt: "2026-10-01" });
    const s2 = item({ touchedAt: "2026-09-01" });
    const r = needsALook([o1, o2, d1, d2, s1, s2], TODAY);
    expect(ids(r.overdue)).toEqual([o2.id, o1.id]);
    expect(ids(r.dueSoon)).toEqual([d2.id, d1.id]);
    expect(ids(r.stale)).toEqual([s2.id, s1.id]);
  });

  it("excludes recurring, ideas, done, archived and inbox items", () => {
    const old = { touchedAt: "2026-01-01", due: "2026-10-01" };
    const r = needsALook(
      [
        item({ ...old, recur: ["mon"] }),
        item({ ...old, kind: "idea" }),
        item({ ...old, status: "done" }),
        item({ ...old, status: "archived" }),
        item({ ...old, areaId: "inbox" }),
      ],
      TODAY,
    );
    expect(r).toEqual({ overdue: [], dueSoon: [], stale: [] });
  });

  it("an item appears in only one group (overdue or due soon beats stale)", () => {
    const a = item({ due: "2026-10-01", touchedAt: "2026-01-01" });
    const b = item({ due: "2026-10-28", touchedAt: "2026-01-01" });
    const c = item({ touchedAt: "2026-01-01" });
    const r = needsALook([a, b, c], TODAY);
    expect(ids(r.overdue)).toEqual([a.id]);
    expect(ids(r.dueSoon)).toEqual([b.id]);
    expect(ids(r.stale)).toEqual([c.id]);
  });

  it("an item due far in the future that is stale is still stale", () => {
    const a = item({ due: "2026-12-25", touchedAt: "2026-01-01" });
    expect(ids(needsALook([a], TODAY).stale)).toEqual([a.id]);
  });

  it("works across month and year boundaries", () => {
    const r = needsALook(
      [item({ due: "2026-12-31" }), item({ due: "2027-01-02" }), item({ due: "2027-01-03" }), item({ due: "2026-12-30" })],
      "2026-12-31",
    );
    expect(r.overdue).toHaveLength(1);
    expect(r.dueSoon).toHaveLength(3);
    const s = needsALook([item({ touchedAt: "2026-12-18" }), item({ touchedAt: "2026-12-19" })], "2027-01-01");
    expect(s.stale).toHaveLength(1);
  });
});
