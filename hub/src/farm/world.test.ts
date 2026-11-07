import type { Item } from "../domain/types";
import { todayList } from "../domain/triage";
import { COLLECTION, STICKERS, STICKER_BY_KEY, hintFor, stickersIn } from "./catalogue";
import {
  ACCESSORIES, ARRIVES_AT, BED_STAGE_AT, PAGES, SPOTS, SPREADS, arrivedAt, awakeZones, bedStage, bedStageEarned, farmDay, momentQueue, nookHost,
  sleeping, spreadOf, spreadOfSticker, stickerTotals, todayListFinished, unlockedAccessories, wakeAt,
} from "./world";
import type { CharacterId } from "./state";

describe("arrivals", () => {
  it("at 0, 5, 20, 45, 80 and 120 stickers", () => {
    expect(ARRIVES_AT).toEqual({ domino: 0, bap: 5, puddle: 20, clover: 45, crumpet: 80, duvet: 120 });
    expect(arrivedAt(0, 1)).toEqual(["domino"]);
    expect(arrivedAt(4, 1)).toEqual(["domino"]);
    expect(arrivedAt(5, 1)).toEqual(["domino", "bap"]);
    expect(arrivedAt(170, 1)).toHaveLength(6);
  });

  it("or on day N of the farm, whichever comes first (Esme, 2026-11-04): calendar days, the start is day 1", () => {
    expect(farmDay("2026-11-04", "2026-11-04")).toBe(1);
    expect(farmDay("2026-11-04", "2026-11-08")).toBe(5);
    expect(farmDay("2026-11-04", "2027-03-03")).toBe(120); // days, not days active
    expect(arrivedAt(0, 4)).toEqual(["domino"]);
    expect(arrivedAt(0, 5)).toEqual(["domino", "bap"]);
    expect(arrivedAt(0, 119)).not.toContain("duvet");
    expect(arrivedAt(0, 120)).toEqual(["domino", "bap", "puddle", "clover", "crumpet", "duvet"]); // zero stickers, day 120
    expect(arrivedAt(45, 21)).toEqual(["domino", "bap", "puddle", "clover"]); // stickers first
    expect(arrivedAt(3, 45)).toEqual(["domino", "bap", "puddle", "clover"]); // days first
  });
});

describe("sticker totals (Esme, 2026-11-04)", () => {
  it("bonus stickers count once each toward friends and hats, never toward the 175", () => {
    // Fictional: Welcome, a Mind seed, and Art cleared (×3 repeats change nothing: one sticker).
    const t = stickerTotals(new Set(["hi", "seeds-mind", "cleared-art", "cleared-body"]));
    expect(t).toEqual({ collected: 2, friends: 4 });
    expect(arrivedAt(stickerTotals(new Set(["hi", "seeds-mind", "seeds-art", "cleared-art", "cleared-body"])).friends, 1)).toContain("bap");
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
    // The crown is the whole collection (Esme): every one of the 175, bonus stickers aside.
    const all = new Set(COLLECTION.map((s) => s.key));
    expect(unlockedAccessories(175, new Set(), all)).toContain("A13");
    const allButOne = new Set([...all].slice(1));
    expect(unlockedAccessories(182, new Set(), new Set([...allButOne, ...STICKERS.filter((s) => s.bonus).map((s) => s.key)]))).not.toContain("A13");
    expect(unlockedAccessories(0, new Set(), hedgerow("nov"))).toEqual(["A9"]); // November leaf: autumn
    expect(unlockedAccessories(0, new Set(["pond", "museum"]), hedgerow("holly"))).toEqual(["A10", "H4", "H7"]);
  });

  it("wellies come with the Welcome back sticker, not weather (Esme, 2026-11-04)", () => {
    expect(STICKER_BY_KEY.get("door")!.rule).toEqual({ source: "returns", at: 1 }); // Welcome back
    expect(unlockedAccessories(0, new Set(), new Set())).not.toContain("A11");
    expect(unlockedAccessories(0, new Set(), new Set(["door"]))).toEqual(["A11"]);
    expect(ACCESSORIES.find((a) => a.code === "A11")!.unlock).not.toMatch(/rain/i);
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

  it.each([[0, 0], [1, 1], [4, 1], [5, 2], [10, 3], [25, 4], [39, 4], [40, 5], [300, 5]])("%i to-dos: stage %i (the last at 40)", (n, stage) => {
    expect(bedStage(n)).toBe(stage);
  });

  it("a bed's stage comes from its earned stickers, so it never shrinks (review I3)", () => {
    expect(bedStageEarned("Mind", new Set())).toBe(0);
    expect(bedStageEarned("Mind", new Set(["seeds-mind", "sprout-mind"]))).toBe(1); // the sprout (3) isn't a stage
    expect(bedStageEarned("Mind", new Set(["seeds-mind", "herbsprout", "chamomile", "herbbundle", "moth"]))).toBe(5);
    expect(STICKER_BY_KEY.get("moth")!.rule.at).toBe(40); // the bed's last stage moved from 50 to 40
    expect(BED_STAGE_AT).toEqual([1, 5, 10, 25, 40]);
    expect(bedStageEarned("Writing", new Set(["seeds-mind"]))).toBe(0);
  });
});

describe("the book", () => {
  it("14 spreads: the contents, then 26 pages spaced out for captions (Esme, 2026-11-06), Bonus last", () => {
    expect(SPREADS).toHaveLength(14);
    expect(PAGES).toHaveLength(26);
    expect(SPREADS[0]!.zones).toEqual([]);
    expect(SPREADS[5]!.zones).toEqual(["meadow"]);
    expect(SPREADS[6]!.zones).toEqual(["meadow", "barnyard"]);
    expect(SPREADS[13]!.zones).toEqual(["lane"]);
    expect(PAGES.at(-1)!.group).toBe("bonus");
    expect(spreadOf("beds")).toBe(1);
    expect(spreadOf("pond")).toBe(9);
    expect(spreadOf("lane")).toBe(12);
    expect(spreadOfSticker("hen")).toBe(6);
    expect(spreadOfSticker("oak-12")).toBe(6);
    // Every sticker has exactly one slot.
    const slots = SPREADS.flatMap((s) => s.pages.flatMap((p) => p?.slots ?? []));
    expect(slots.map((s) => s.sticker).sort()).toEqual(STICKERS.map((s) => s.key).sort());
  });
});

describe("spots", () => {
  it("every sticker has the designer's fixed spot: the farm (504x276) or a museum/aquarium interior", () => {
    expect(SPOTS.size).toBe(183);
    expect(SPOTS.get("cleared-mind")).toMatchObject({ scene: "farm", layer: "bed-sign", placeholder: false });
    // The sticker swap's five new barnyard stickers wait for Art: an obviously wrong spot until then.
    const undrawn = ["horse", "goat", "rooster", "barn-cat", "owl"];
    expect([...SPOTS].filter(([, s]) => s.placeholder).map(([k]) => k).sort()).toEqual([...undrawn].sort());
    for (const k of undrawn) expect(SPOTS.get(k)).toMatchObject({ scene: "farm", zone: "barnyard" });
    for (const [k, s] of SPOTS) {
      if (undrawn.includes(k)) continue;
      expect(s.placeholder).toBe(false);
      const [w, h] = s.scene === "farm" ? [504, 276] : [200, 96];
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x + 16).toBeLessThanOrEqual(w);
      expect(s.y + 16).toBeLessThanOrEqual(h);
    }
    expect([...SPOTS.values()].filter((s) => s.scene !== "farm")).toHaveLength(21); // the bookmark went in the swap
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

  it("an item moved to a later day counts as off the list (rescheduling is never a failure; Esme, 2026-11-04)", () => {
    const tomorrow = "2026-11-05";
    // Fictional: 10 open to-dos; this morning's 4 picks. She ticks two and moves two on.
    const items: Item[] = Array.from({ length: 10 }, () => t({ touchedAt: "2026-11-01" }));
    const [a, b, c, d] = todayList(items, [], T).picks;
    const after = items.map((i) => {
      if (i.id === a!.id || i.id === b!.id) return { ...i, status: "done" as const, completedAt: T, touchedAt: T };
      if (i.id === c!.id) return { ...i, pinnedDate: tomorrow, touchedAt: T }; // Do it on: Tomorrow
      if (i.id === d!.id) return { ...i, hiddenOn: T, touchedAt: T }; // Remove from today
      return i;
    });
    expect(todayListFinished(after, [], T)).toBe(true);
    // Only one ticked and one still waiting: not yet.
    const half = after.map((i) => (i.id === b!.id ? items.find((x) => x.id === b!.id)! : i));
    expect(todayListFinished(half, [], T)).toBe(false);
  });

  it("a deadline moved past today counts as moved too", () => {
    const items: Item[] = [t({ due: T, touchedAt: "2026-11-01" }), t({ pinnedDate: T, touchedAt: "2026-11-01" })];
    const after = [{ ...items[0]!, due: "2026-11-20", touchedAt: T }, { ...items[1]!, status: "done" as const, completedAt: T, touchedAt: T }];
    expect(todayListFinished(after, [], T)).toBe(true);
  });

  it("needs at least one thing ticked: moving everything on isn't a finished list", () => {
    const items: Item[] = [t({ pinnedDate: T, touchedAt: "2026-11-01" }), t({ pinnedDate: T, touchedAt: "2026-11-01" })];
    const moved = items.map((i) => ({ ...i, pinnedDate: "2026-11-06", touchedAt: T }));
    expect(todayListFinished(moved, [], T)).toBe(false);
    expect(todayListFinished([{ ...moved[0]!, pinnedDate: T, status: "done" as const, completedAt: T }, moved[1]!], [], T)).toBe(true);
  });

  it("a habit taken off today counts as moved; a habit ticked counts as ticked", () => {
    const items: Item[] = [t({ recur: ["wed"], touchedAt: "2026-11-01" }), t({ recur: ["wed"], touchedAt: "2026-11-01" })];
    const after = [{ ...items[0]!, hiddenOn: T, touchedAt: T }, { ...items[1]!, doneDates: [T], touchedAt: T }];
    expect(todayListFinished(after, [], T)).toBe(true);
  });

  it("its hint says ticked or moved (placeholder wording)", () => {
    expect(hintFor(STICKERS.find((s) => s.rule.source === "today-finished" && s.rule.at === 3)!)).toMatch(/ticked or moved/);
  });

  it("ticking things that weren't on the list doesn't finish it", () => {
    const items: Item[] = Array.from({ length: 10 }, () => t({}));
    const onList = new Set(todayList(items, [], T).picks.map((i) => i.id));
    const ticked = items.map((i) => (onList.has(i.id) ? i : { ...i, status: "done" as const, completedAt: T }));
    expect(todayListFinished(ticked, [], T)).toBe(false);
  });
});
