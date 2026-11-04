import type { Item } from "../domain/types";
import { todayList } from "../domain/triage";
import { STICKERS, stickersIn } from "./catalogue";
import type { Counters } from "./earning";
import {
  ACCESSORIES, ARRIVES_AT, SPOTS, SPREADS, arrivedAt, awakeZones, bedStage, momentQueue, nookHost, sleeping, spreadOf,
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
  const months = (...m: string[]): Counters => new Map(m.map((x) => [`month:${x}`, 1])) as never;
  it("18 of them, unlocked by totals, seasons and awake host zones", () => {
    expect(ACCESSORIES).toHaveLength(18);
    expect(unlockedAccessories(0, new Set(), null)).toEqual([]);
    expect(unlockedAccessories(5, new Set(), null)).toEqual(["A1"]);
    expect(unlockedAccessories(100, new Set(), null)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "A7"]);
    expect(unlockedAccessories(0, new Set(), months("Nov"))).toEqual(["A9"]);
    expect(unlockedAccessories(0, new Set(["pond", "museum"]), months("Dec"))).toEqual(["A10", "H4", "H7"]);
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
});

describe("the book", () => {
  it("8 spreads: the contents, then two pages each", () => {
    expect(SPREADS).toHaveLength(8);
    expect(SPREADS[0]!.zones).toEqual([]);
    expect(SPREADS[3]!.zones).toEqual(["meadow", "barnyard"]);
    expect(spreadOf("beds")).toBe(1);
    expect(spreadOf("lane")).toBe(7);
    expect(spreadOfSticker("hen")).toBe(3);
    // Every sticker has exactly one slot.
    const slots = SPREADS.flatMap((s) => s.pages.flatMap((p) => p?.slots ?? []));
    expect(slots.map((s) => s.sticker).sort()).toEqual(STICKERS.map((s) => s.key).sort());
  });
});

describe("spots", () => {
  it("every sticker has one fixed spot on the farm (the barnyard animals the designer's)", () => {
    expect(SPOTS.size).toBe(170);
    expect(SPOTS.get("hen")).toEqual({ x: 254, y: 40, placeholder: false });
    expect(SPOTS.get("seeds-mind")!.placeholder).toBe(true);
    for (const s of SPOTS.values()) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x + 16).toBeLessThanOrEqual(336);
      expect(s.y + 16).toBeLessThanOrEqual(184);
    }
  });
});

describe("the earned-moment queue", () => {
  it("new stickers, in book order; journal stickers wait while she's on the Journal", () => {
    const derived = ["seeds-mind", "lilypad", "hi"];
    expect(momentQueue(derived, new Set(["hi"]), new Map(), false)).toEqual(["seeds-mind", "lilypad"]);
    expect(momentQueue(derived, new Set(["hi"]), new Map(), true)).toEqual(["seeds-mind"]);
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
