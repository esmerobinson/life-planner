import type { Goal, ISODate, Item, Weekday } from "../domain/types";
import { COLLECTION, GROUPS, STICKERS, STICKER_BY_KEY, asset, hintFor, ruleOf, stickersIn } from "./catalogue";
import { allEarned, clipItems, counters, derivedEarned, workbookProgress, type EarningInput, type JournalFacts } from "./earning";

// The v2 milestone table (tmp/game-design.md section 7), copied here by hand so the art pack's
// manifest is checked against the design, not against itself. Pacing re-spaced by Esme on
// 2026-11-04 (farm-brief-2026-11-04.md item 3): beds top at 60, Animals at 200, Glasshouse at 150.
// The sticker swap (Art session, approved 2026-11-06; ladders by Game Design the same day): out go
// pebbles, stepping stone, seed tray, the kitchen lantern and the bookmark; in come a black horse,
// goat and rooster (Animals) and a barn cat and owl (Barn things). Still 175.
const V2: Record<string, [string, number[]]> = {
  "Mind bed": ["todos:mind", [1, 3, 5, 10, 25, 40, 60]],
  "Writing bed": ["todos:writing", [1, 3, 5, 10, 25, 40, 60]],
  "Art bed": ["todos:art", [1, 3, 5, 10, 25, 40, 60]],
  "Content bed": ["todos:content", [1, 3, 5, 10, 25, 40, 60]],
  "Body bed": ["todos:body", [1, 3, 5, 10, 25, 40, 60]],
  "Tech bed": ["todos:tech", [1, 3, 5, 10, 25, 40, 60]],
  "Production bed": ["todos:production", [1, 3, 5, 10, 25, 40, 60]],
  "Admin bed": ["todos:admin", [1, 3, 5, 10, 25, 40, 60]],
  "Bee things": ["today-finished", [1, 3, 5, 10, 15, 25, 40, 60]],
  "Hedge flowers": ["habit-weeks", [1, 4, 8, 12, 26, 52]],
  Animals: ["habit-sessions", [1, 5, 10, 20, 30, 45, 60, 80, 110, 150, 200]],
  "Barn things": ["habit-months", [1, 2, 3, 5, 8, 12]],
  "Fruit trees": ["monthly-goals", [1, 2, 4, 6, 9, 12, 18]],
  "Under the trees": ["whole-goals", [1, 3]],
  Glasshouse: ["morning-pages", [1, 3, 5, 10, 20, 30, 50, 75, 100, 125, 150]],
  "Lily pads": ["checkins", [1, 5, 15, 30, 60, 100]],
  "Water's edge": ["exercise-days", [1, 3, 10, 25, 50, 75]],
  "Stream fish": ["chapters", [1, 3, 6, 10, 15, 20, 25, 30]],
  Kitchen: ["weekly-reviews", [1, 4, 12, 26, 52]],
  "Harvest table": ["monthly-reviews", [1, 3, 6, 9, 12]],
  "Pressed and bound": ["reading-books", [1, 3, 7, 12, 20]],
  "Dug up": ["projects", [1, 2, 3, 5, 8, 12]],
};
// Meadow: v2's fourteen plus the five "Seasons kept" stickers (Esme, 2026-11-04).
const GROUP_SIZES = { beds: 56, meadow: 19, barnyard: 17, orchard: 9, glasshouse: 11, pond: 12, aquarium: 10, farmhouse: 10, museum: 11, lane: 20 };

describe("the 170 stickers match game design v2", () => {
  it("175 stickers (v2's 170 and the five Seasons kept) in 10 groups", () => {
    expect(COLLECTION).toHaveLength(175);
    expect(STICKERS.filter((s) => s.bonus)).toHaveLength(8); // Area cleared, one per area: outside the collection
    expect(GROUPS).toEqual(Object.keys(GROUP_SIZES));
    for (const [g, n] of Object.entries(GROUP_SIZES)) expect(stickersIn(g)).toHaveLength(n);
    expect(new Set(STICKERS.map((s) => s.key)).size).toBe(183);
  });

  it.each(Object.entries(V2))("%s: source and milestones", (set, [source, milestones]) => {
    const mine = STICKERS.filter((s) => s.set === set);
    expect(mine.map((s) => s.rule.source)).toEqual(milestones.map(() => source));
    expect(mine.map((s) => s.rule.at)).toEqual(milestones);
    // The book's slots say the same (the pack keeps each milestone twice).
    const slots = (asset("book-pages") as unknown as { pages: { slots: { sticker: string; milestone: number | string }[] }[] }).pages
      .flatMap((p) => p.slots);
    expect(mine.map((s) => slots.find((sl) => sl.sticker === s.key)?.milestone)).toEqual(milestones);
  });

  it("no two stickers of a set share a target (re-spaced pacing)", () => {
    for (const set of new Set(STICKERS.map((s) => s.set))) {
      const keyed = STICKERS.filter((s) => s.set === set).map((s) => `${s.rule.source} ${s.rule.at}`);
      expect(new Set(keyed).size).toBe(keyed.length);
    }
  });

  it.each([
    ["moonfish", "workbook:dbt"], ["golden-carp", "workbook:bpd"],
    ["hi", "started"], ["door", "returns"], ["steps", "returns"], ["always-welcome", "returns"],
    ["ok", "late-ticks"], ["feather", "short-pages"], ["candle", "checkin-after-gap"], ["back-to-it", "habit-after-week-off"],
    ["robin", "month:Jan"], ["holly", "month:Dec"], ["toadstool", "month:Oct"],
  ])("%s is earned by %s", (key, source) => {
    expect(STICKER_BY_KEY.get(key)!.rule.source).toBe(source);
  });

  it("returns: welcome back at the first, back again at the third, always welcome at the fifth", () => {
    expect(["door", "steps", "always-welcome"].map((k) => STICKER_BY_KEY.get(k)!.rule.at)).toEqual([1, 3, 5]);
  });

  it("journal stickers are marked, and the parts not built yet can't be earned", () => {
    expect(STICKERS.filter((s) => s.journal).map((s) => s.group).sort()).toEqual(
      [...Array(11).fill("glasshouse"), ...Array(12).fill("pond"), ...Array(10).fill("aquarium"), "lane", "lane"].sort(),
    );
    expect(STICKERS.filter((s) => s.later).map((s) => s.set)).toEqual([
      ...Array(5).fill("Kitchen"), ...Array(5).fill("Harvest table"),
    ]);
  });

  it("an earning rule it can't read is an error, not a silent never", () => {
    expect(() => ruleOf({ earned_by: "coins", milestone: 1 })).toThrow();
  });

  it("every sticker has a hint", () => {
    for (const s of STICKERS) expect(hintFor(s)).toMatch(/\w/);
    expect(hintFor(STICKER_BY_KEY.get("chamomile")!)).toBe("10 to-dos ticked off in Mind");
    expect(hintFor(STICKER_BY_KEY.get("seeds-mind")!)).toBe("1 to-do ticked off in Mind");
  });
});

// ---- counting, with fictional data -------------------------------------------------------

const START = "2026-11-02"; // a Monday
let n = 0;
const task = (p: Partial<Item> = {}): Item => ({
  id: `t${++n}`, kind: "task", title: `Pretend ${n}`, links: [], areaId: "mind", priority: 2, status: "open",
  createdAt: "2026-10-01", touchedAt: "2026-10-01", ...p,
});
const done = (completedAt: ISODate, p: Partial<Item> = {}) => task({ status: "done", completedAt, ...p });
const habit = (recur: Weekday[], doneDates: ISODate[], p: Partial<Item> = {}) => task({ recur, doneDates, ...p });
const input = (p: Partial<EarningInput> = {}): EarningInput => ({
  start: START, today: "2026-11-30", items: [], goals: [], todayDone: [], journal: null, ...p,
});
const NO_JOURNAL: JournalFacts = {
  morning: new Set(), shortPages: new Set(), checkins: new Set(), exercise: [], chapters: [], workbooks: { dbt: null, bpd: null },
};
const count = (p: Partial<EarningInput>, source: string) => counters(input(p)).get(source as never);

describe("counters", () => {
  it("a fresh start earns only the Welcome sticker", () => {
    expect(derivedEarned(counters(input()))).toEqual(["hi"]);
  });

  it("to-dos count per area, only when ticked on or after the start (created earlier is fine)", () => {
    const items = [
      done("2026-11-02"), done("2026-11-03"), done("2026-11-01"), // one before the start
      done("2026-11-05", { areaId: "art" }),
      done("2026-11-05", { areaId: "inbox" }), // unsorted: not a to-do yet
      task(), // open
      done("2026-11-05", { kind: "idea" }),
    ];
    expect(count({ items }, "todos:mind")).toBe(2);
    expect(count({ items }, "todos:art")).toBe(1);
    const earned = derivedEarned(counters(input({ items })));
    expect(earned).toContain("seeds-mind");
    expect(earned).not.toContain("sprout-mind"); // 3
    expect(earned).toContain("seeds-art");
  });

  it.each([
    [1, ["seeds-mind"]],
    [3, ["seeds-mind", "sprout-mind"]],
    [10, ["seeds-mind", "sprout-mind", "herbsprout", "chamomile"]],
    [100, ["seeds-mind", "sprout-mind", "herbsprout", "chamomile", "herbbundle", "moth", "prize-mind"]],
  ])("%i Mind to-dos earn the Mind bed up to its milestone", (k, keys) => {
    const items = Array.from({ length: k }, () => done("2026-11-10"));
    expect(derivedEarned(counters(input({ items }))).filter((x) => x.endsWith("mind") || ["herbsprout", "chamomile", "herbbundle", "moth"].includes(x))).toEqual(keys);
  });

  it("habits: sessions are each ticked day once; weeks count weeks with any session", () => {
    const items = [
      habit(["mon", "wed"], ["2026-10-26", "2026-11-02", "2026-11-04", "2026-11-11"]),
      habit(["tue"], ["2026-11-03"]),
    ];
    expect(count({ items }, "habit-sessions")).toBe(4);
    expect(count({ items }, "habit-weeks")).toBe(2);
    // A habit's sessions are not to-dos.
    expect(count({ items }, "todos:mind")).toBe(0);
  });

    it("back to it: a habit again after a week off (never counts the days missed)", () => {
    expect(count({ items: [habit(["mon"], ["2026-11-02", "2026-11-09"])] }, "habit-after-week-off")).toBe(0);
    expect(count({ items: [habit(["mon"], ["2026-11-02", "2026-11-16"])] }, "habit-after-week-off")).toBe(1);
  });

  it("finished Today lists count the days seen finished since the start", () => {
    expect(count({ todayDone: ["2026-11-01", "2026-11-02", "2026-11-03"] }, "today-finished")).toBe(2);
  });

  it("projects finished and late ticks", () => {
    const project = done("2026-11-06", {
      sessions: [{ id: "a", doneOn: "2026-11-05" }, { id: "b", doneOn: "2026-11-06" }],
    });
    const late = done("2026-11-08", { due: "2026-11-06", areaId: "admin" });
    expect(count({ items: [project, late] }, "projects")).toBe(1);
    expect(count({ items: [project, late] }, "late-ticks")).toBe(1);
  });

  it("returns: coming back after 3 or more days with nothing (the start day counts)", () => {
    const items = [done("2026-11-03"), done("2026-11-07"), done("2026-11-08"), done("2026-11-20"), done("2026-11-24")];
    // Gaps of days with nothing: 2-3: 0, 3-7: 3 (a return), 7-8: 0, 8-20: 11 (a return), 20-24: 3 (a return).
    expect(count({ items }, "returns")).toBe(3);
    const earned = derivedEarned(counters(input({ items })));
    expect(earned).toEqual(expect.arrayContaining(["door", "steps"]));
    expect(earned).not.toContain("always-welcome");
  });

  it("hedgerow months: any activity at all in that month", () => {
    const items = [done("2026-12-24"), done("2027-01-02")];
    const c = counters(input({ items, today: "2027-01-10" }));
    // Opening the farm in November isn't "doing anything": only real activity counts.
    expect([c.get("month:Nov"), c.get("month:Dec"), c.get("month:Jan"), c.get("month:Feb")]).toEqual([undefined, 1, 1, undefined]);
  });

  it("monthly goals reached since the start", () => {
    const g: Goal = {
      id: "g1", title: "Pretend goal", areaId: "art", kind: "practice", milestones: [], createdAt: "2026-10-01",
      monthGoals: [
        { id: "m1", month: "2026-11", kind: "count", title: "Sessions", target: 2, log: ["2026-11-03", "2026-11-04"] },
        { id: "m2", month: "2026-10", kind: "count", title: "Sessions", target: 1, log: ["2026-10-03"] }, // before the start
      ],
    };
    expect(count({ goals: [g] }, "monthly-goals")).toBe(1);
    const g2 = { ...g, monthGoals: [{ ...g.monthGoals![0]!, log: ["2026-11-01", "2026-11-04"] }] }; // one before the start
    expect(count({ goals: [g2] }, "monthly-goals")).toBe(0);
  });

  it("whole goals: every milestone of a finite goal done, the last one since the start", () => {
    const g: Goal = { id: "g9", title: "Pretend finite", areaId: "writing", kind: "finite", milestones: [], createdAt: "2026-10-01" };
    const steps = [done("2026-10-20", { goalId: "g9", areaId: "writing", milestone: true }), done("2026-11-12", { goalId: "g9", areaId: "writing", milestone: true })];
    expect(count({ goals: [g], items: steps }, "whole-goals")).toBe(1);
    expect(count({ goals: [g], items: [steps[0]!, task({ goalId: "g9", areaId: "writing", milestone: true })] }, "whole-goals")).toBe(0);
  });

  it("journal counters are absent while the journal is locked (those stickers simply wait)", () => {
    const c = counters(input());
    expect(c.has("morning-pages")).toBe(false);
    expect(c.has("checkins")).toBe(false);
  });

  it("journal: mornings not words, exercise days not cards, check-ins after a break", () => {
    const journal: JournalFacts = {
      ...NO_JOURNAL,
      morning: new Set(["2026-11-01", "2026-11-02", "2026-11-03"]),
      shortPages: new Set(["2026-11-03"]),
      checkins: new Set(["2026-11-02", "2026-11-03", "2026-11-09"]),
      exercise: [
        { date: "2026-11-02", card: "a" }, { date: "2026-11-02", card: "b" }, { date: "2026-11-04", card: "c" },
      ],
    };
    const c = counters(input({ journal }));
    expect(c.get("morning-pages")).toBe(2);
    expect(c.get("short-pages")).toBe(1);
    expect(c.get("checkins")).toBe(3);
    expect(c.get("checkin-after-gap")).toBe(1);
    expect(c.get("exercise-days")).toBe(2);
  });

  it("the parts not built yet are never earned", () => {
    const c = new Map([["weekly-reviews", 99], ["started", 1]]) as never;
    expect(derivedEarned(c)).toEqual(["hi"]);
  });
});

describe("allEarned: nothing is ever lost", () => {
  it("keeps a sticker already seen even when the count behind it drops", () => {
    const c = counters(input());
    expect(allEarned(c, new Set(["seeds-mind"]), new Map())).toEqual(["seeds-mind", "hi"]);
    expect(allEarned(null, new Set(), new Map([["hen", "hen"]]))).toEqual(["hen"]);
  });
});

describe("clipItems", () => {
  it("takes off what was done before the start, without changing the rows", () => {
    const h = habit(["mon"], ["2026-10-26", "2026-11-02"]);
    const t = done("2026-11-01");
    const [ch, ct] = clipItems([h, t], START);
    expect(ch!.doneDates).toEqual(["2026-11-02"]);
    expect(ct!.status).toBe("open");
    expect(t.status).toBe("done");
  });
});

describe("workbookProgress", () => {
  const card = (id: string, track: string, chapter: number | null, day: number | null = 1, optional = false) => ({ id, track, chapter, day, optional });
  const cards = [
    card("d1", "dbt", 1), card("d2", "dbt", 1, 2), card("d3", "dbt", 2, 3),
    card("b1", "bpd", 1), card("intro", "dbt", null, null, true),
  ];
  const tracks = [{ id: "dbt", title: "DBT Skills Workbook" }, { id: "bpd", title: "The BPD workbook" }];

  it("a chapter is finished on the day its last card was first done", () => {
    const r = workbookProgress(cards, tracks, [
      { date: "2026-11-03", id: "d1", done: true }, { date: "2026-11-05", id: "d2", done: true },
      { date: "2026-11-09", id: "d2", done: true }, { date: "2026-11-06", id: "d3", done: false },
    ]);
    expect(r.chapters).toEqual([{ track: "dbt", chapter: 1, doneOn: "2026-11-05" }]);
    expect(r.workbooks).toEqual({ dbt: null, bpd: null });
  });

  it("a whole workbook when every chapter is", () => {
    const r = workbookProgress(cards, tracks, [
      { date: "2026-11-03", id: "d1", done: true }, { date: "2026-11-05", id: "d2", done: true },
      { date: "2026-11-07", id: "d3", done: true }, { date: "2026-11-04", id: "b1", done: true },
    ]);
    expect(r.workbooks).toEqual({ dbt: "2026-11-07", bpd: "2026-11-04" });
  });
});
