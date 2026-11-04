import type { Item } from "../domain/types";
import { todayList } from "../domain/triage";
import { STICKERS, stickersIn } from "./catalogue";
import {
  ACCESSORIES, ARRIVES_AT, SPOTS, SPREADS, arrivedAt, awakeZones, bedStage, bedStageEarned, momentQueue, nookHost, sleeping, spreadOf,
  spreadOfSticker, todayListFinished, unlockedAccessories, wakeAt,
} from "./world";
import type { CharacterId } from "./state";

describe("arrivals", () => {
  it("at 0, 5, 20, 45, 80 and 120 stickers", () => {
    expect(ARRIVES_AT).toEqual({ domino: 0, bap: 5, puddle: 20, clover: 45, crumpet: 80, duvet: 120 });
    expect(arrivedAt(0)).toEqual(["domino"]);
    expect(arrivedAt(4)).toEqual(["domino"]);
    expect(arrivedAt(5)).toEqual(["domino", "bap"]);
    expect(arrivedAt(170)).toHaveLength(6);
  });
});

describe("nook hosts", () => {
  const all = new Set<CharacterId>(["domino", "bap", "puddle", "clover", "crumpet", "duvet"]);
  const only = (...c: CharacterId[]) => new Set<CharacterId>(["domino", ...c]);
  it.each([
    ["/", all, undefined, "domino"],
    ["/today", all, undefined, "domino"],
    ["/journal/check-in", all, undefined, "bap"],
    ["/journal/exercise", only(), undefined, "domino"], // before Bap arrives, Domino stays
    ["/journal/morning", all, undefined, "clover"],
    ["/journal/morning", only("bap"), undefined, "bap"],
    ["/farm", all, [], "puddle"], // the sticker book
    ["/farm", only(), [], "domino"],
    ["/farm", all, ["pond"], "bap"],
    ["/farm", all, ["meadow", "barnyard"], "puddle"],
    ["/farm", only("bap"), ["meadow", "barnyard"], "domino"],
    ["/farm", all, ["beds"], "domino"],
  ] as const)("%s %#", (path, arrived, zones, who) => {
    expect(nookHost({ path, farmZones: zones }, arrived)).toBe(who);
  });
});

it("sleeps at night and while she writes Morning pages", () => {
  expect(sleeping(23, false)).toBe(true);
  expect(sleeping(3, false)).toBe(true);
  expect(sleeping(10, false)).toBe(false);
  expect(sleeping(10, true)).toBe(true);
});

describe("accessories", () => {
  const hedgerow = (...keys: string[]) => new Set(keys);
  it("20 of them, unlocked by totals, by earned Hedgerow months (kept for good) and awake host zones", () => {
    expect(ACCESSORIES).toHaveLength(20);
    expect(unlockedAccessories(0, new Set(), new Set())).toEqual([]);
    expect(unlockedAccessories(5, new Set(), new Set())).toEqual(["A1"]);
    expect(unlockedAccessories(100, new Set(), new Set())).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "A7"]);
    expect(unlockedAccessories(130, new Set(), new Set())).toContain("A12");
    expect(unlockedAccessories(174, new Set(), new Set())).not.toContain("A13"); // the crown is the whole collection (Esme)
    expect(unlockedAccessories(175, new Set(), new Set())).toContain("A13");
    expect(unlockedAccessories(0, new Set(), hedgerow("nov"))).toEqual(["A9"]); // November leaf: autumn
    expect(unlockedAccessories(0, new Set(["pond", "museum"]), hedgerow("holly"))).toEqual(["A10", "H4", "H7"]);
  });
});

describe("zones and beds", () => {
  it("a zone wakes at half its stickers (rounded up)", () => {
    expect(wakeAt("beds")).toBe(28);
    expect(wakeAt("orchard")).toBe(5);
    const half = stickersIn("orchard").slice(0, 5).map((s) => s.key);
    expect([...awakeZones(half)]).toEqual(["orchard"]);
    expect([...awakeZones(half.slice(0, 4))]).toEqual([]);
  });

  it.each([[0, 0], [1, 1], [4, 1], [5, 2], [10, 3], [25, 4], [49, 4], [50, 5], [300, 5]])("%i to-dos: stage %i", (n, stage) => {
    expect(bedStage(n)).toBe(stage);
  });

  it("a bed's stage comes from its earned stickers, so it never shrinks (review I3)", () => {
    expect(bedStageEarned("Mind", new Set())).toBe(0);
    expect(bedStageEarned("Mind", new Set(["seeds-mind", "sprout-mind"]))).toBe(1); // the sprout (3) isn't a stage
    expect(bedStageEarned("Mind", new Set(["seeds-mind", "herbsprout", "chamomile", "herbbundle", "moth"]))).toBe(5);
    expect(bedStageEarned("Writing", new Set(["seeds-mind"]))).toBe(0);
  });
});

describe("the book", () => {
  it("9 spreads: the contents, then two pages each (the Meadow takes two; a back endpaper closes it)", () => {
    expect(SPREADS).toHaveLength(9);
    expect(SPREADS[0]!.zones).toEqual([]);
    expect(SPREADS[3]!.zones).toEqual(["meadow"]);
    expect(SPREADS[8]!.zones).toEqual(["lane"]);
    expect(spreadOf("beds")).toBe(1);
    expect(spreadOf("lane")).toBe(7);
    expect(spreadOfSticker("hen")).toBe(4);
    expect(spreadOfSticker("oak-12")).toBe(3);
    // Every sticker has exactly one slot.
    const slots = SPREADS.flatMap((s) => s.pages.flatMap((p) => p?.slots ?? []));
    expect(slots.map((s) => s.sticker).sort()).toEqual(STICKERS.map((s) => s.key).sort());
  });
});

describe("spots", () => {
  it("every sticker has the designer's fixed spot: the farm (504x276) or a museum/aquarium interior", () => {
    expect(SPOTS.size).toBe(183);
    expect(SPOTS.get("cleared-mind")).toMatchObject({ scene: "farm", layer: "bed-sign", placeholder: false });
    for (const s of SPOTS.values()) {
      expect(s.placeholder).toBe(false);
      const [w, h] = s.scene === "farm" ? [504, 276] : [200, 96];
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x + 16).toBeLessThanOrEqual(w);
      expect(s.y + 16).toBeLessThanOrEqual(h);
    }
    expect([...SPOTS.values()].filter((s) => s.scene !== "farm")).toHaveLength(22);
    expect(SPOTS.get("seeds-mind")).toMatchObject({ layer: "bed", draw: false });
    expect(SPOTS.get("minnow")).toMatchObject({ scene: "aquarium-interior" });
  });
});

describe("the earned-moment queue", () => {
  it("new stickers, in book order; every moment waits while she's on the Journal (review I5)", () => {
    const derived = ["seeds-mind", "lilypad", "hi"];
    expect(momentQueue(derived, new Set(["hi"]), new Map(), false)).toEqual(["seeds-mind", "lilypad"]);
    expect(momentQueue(derived, new Set(["hi"]), new Map(), true)).toEqual([]);
    expect(momentQueue(derived, new Set(), new Map([["seeds-mind", "seeds-mind"]]), false)).toEqual(["lilypad", "hi"]);
  });
});

describe("Today's list finished", () => {
  const T = "2026-11-04";
  const t = (p: Partial<Item>): Item => ({
    id: Math.random().toString(36).slice(2), kind: "task", title: "Pretend", links: [], areaId: "art", priority: 2, status: "open",
    createdAt: T, touchedAt: T, ...p,
  });
  it("needs something on it, all ticked", () => {
    expect(todayListFinished([], [], T)).toBe(false);
    expect(todayListFinished([t({ pinnedDate: T })], [], T)).toBe(false);
    expect(todayListFinished([t({ pinnedDate: T, status: "done", completedAt: T })], [], T)).toBe(true);
    expect(todayListFinished([t({ pinnedDate: T, status: "done", completedAt: T }), t({ pinnedDate: T })], [], T)).toBe(false);
    expect(todayListFinished([t({ recur: ["wed"], doneDates: [T] })], [], T)).toBe(true); // 4 Nov 2026 is a Wednesday
  });

  it("a backlog: the list as it stood at the start of the day counts, not the refills (review C1)", () => {
    // Fictional: 10 open to-dos and a habit for today. Home shows 4 picks; ticking one refills it.
    let items: Item[] = [...Array.from({ length: 10 }, () => t({})), t({ recur: ["wed"] })];
    const startOfDay = todayList(items, [], T);
    const onList = [...startOfDay.rhythm, ...startOfDay.picks].map((i) => i.id);
    expect(onList).toHaveLength(5);
    // She ticks them one by one; Home refills the picks from the backlog as she goes.
    for (const id of onList) {
      expect(todayListFinished(items, [], T)).toBe(false);
      items = items.map((i) =>
        i.id !== id ? i : i.recur ? { ...i, doneDates: [T] } : { ...i, status: "done" as const, completedAt: T },
      );
    }
    // Every item that was on the list this morning is ticked: finished, though new picks now show.
    expect(todayList(items, [], T).picks.some((i) => i.status === "open")).toBe(true);
    expect(todayListFinished(items, [], T)).toBe(true);
  });

  it("ticking things that weren't on the list doesn't finish it", () => {
    const items: Item[] = Array.from({ length: 10 }, () => t({}));
    const onList = new Set(todayList(items, [], T).picks.map((i) => i.id));
    const ticked = items.map((i) => (onList.has(i.id) ? i : { ...i, status: "done" as const, completedAt: T }));
    expect(todayListFinished(ticked, [], T)).toBe(false);
  });
});
