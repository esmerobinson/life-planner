import { COLLECTION } from "../farm/catalogue";
import { SCENES, type SceneId } from "./assets";
import { layout, sceneState } from "./placement";
import { rioCounts, scenePlan, type RioCounts } from "./progress";
import { FLAMENGO_FULL_WEEKLY_REVIEWS, JARDIM_FULL_SHARE, SANTA_TERESA_FULL_BOOKS, SULT_FULL_MONTHLY_GOALS } from "./thresholds";

// What each phase-2a area shows for her real counters (thresholds.ts holds the defaults).

const zero: RioCounts = { monthlyGoals: 0, wholeGoals: 0, readingBooks: 0, recipes: 0, weeklyReviews: 0 };
const counts = (c: Partial<RioCounts>): RioCounts => ({ ...zero, ...c });
const keysIn = (group: string) => COLLECTION.filter((s) => s.group === group).map((s) => s.key);

describe("rioCounts", () => {
  it("reads the earning engine's counters, and zeros without them", () => {
    const c = new Map([["monthly-goals", 4], ["whole-goals", 2], ["reading-books", 11]]) as never;
    expect(rioCounts(c)).toEqual({ monthlyGoals: 4, wholeGoals: 2, readingBooks: 11, recipes: 0, weeklyReviews: 0 });
    expect(rioCounts(null)).toEqual(zero);
  });
});

describe("scenePlan", () => {
  it("phase-1 scenes keep their own rule", () => {
    for (const id of ["fazenda/outside", "ipanema-beach/outside", "tijuca-park/outside"] as SceneId[]) {
      const placed = COLLECTION.map((s) => s.key);
      const { bySlot, overflow } = layout(id, placed);
      expect(scenePlan(id, placed, zero).state).toBe(sceneState(id, bySlot.size + overflow));
    }
  });

  it("Jardim Botanico: full once half of both scenes' slots are filled, and both scenes agree", () => {
    const total = SCENES["jardim-botanico/outside"].slots.length + SCENES["jardim-botanico/inside"].slots.length;
    expect(total).toBe(40);
    const need = Math.ceil(total * JARDIM_FULL_SHARE);
    expect(scenePlan("jardim-botanico/outside", [], zero).state).toBe("start");
    const all = [...keysIn("orchard"), ...keysIn("glasshouse")]; // 9 + 12 = 21
    expect(all.length).toBeGreaterThanOrEqual(need);
    expect(scenePlan("jardim-botanico/outside", all.slice(0, need - 1), zero).state).toBe("start");
    expect(scenePlan("jardim-botanico/inside", all.slice(0, need - 1), zero).state).toBe("start");
    expect(scenePlan("jardim-botanico/outside", all.slice(0, need), zero).state).toBe("full");
    expect(scenePlan("jardim-botanico/inside", all.slice(0, need), zero).state).toBe("full");
  });

  it("Sult: full at 7 monthly goals", () => {
    expect(SULT_FULL_MONTHLY_GOALS).toBe(7);
    expect(scenePlan("sult/inside", [], counts({ monthlyGoals: 6 })).state).toBe("start");
    expect(scenePlan("sult/inside", [], counts({ monthlyGoals: 7 })).state).toBe("full");
    expect(scenePlan("sult/outside", [], counts({ monthlyGoals: 7 })).state).toBe("full");
  });

  it("Os Esquilos: one celebration layer per whole goal, up to 5, over the start base", () => {
    for (const [whole, layers] of [[0, 0], [3, 3], [5, 5], [9, 5]] as const) {
      for (const id of ["os-esquilos/outside", "os-esquilos/inside"] as SceneId[]) {
        const p = scenePlan(id, [], counts({ wholeGoals: whole }));
        expect(p.celebrations, `${id} ${whole}`).toBe(layers);
        expect(p.state).toBe("start");
      }
    }
  });

  it("Santa Teresa: milestones at 3, 6, 10, 15 and 20 books; spines and every fifth cover; full (all baked) at 142", () => {
    const at = (n: number) => scenePlan("santa-teresa/inside", [], counts({ readingBooks: n }));
    expect(at(2)).toMatchObject({ state: "start", milestones: [], books: 2, covers: 0 });
    expect(at(3).milestones).toEqual(["reading-lamp"]);
    expect(at(10).milestones).toEqual(["reading-lamp", "second-bookcase", "rug"]);
    expect(at(20)).toMatchObject({ milestones: ["reading-lamp", "second-bookcase", "rug", "cat-bed", "window-seat"], books: 20, covers: 4 });
    expect(SANTA_TERESA_FULL_BOOKS).toBe(142);
    expect(at(142)).toMatchObject({ state: "full", milestones: [], books: 0, covers: 0 });
    expect(scenePlan("santa-teresa/outside", [], counts({ readingBooks: 20 })).state).toBe("start");
    expect(scenePlan("santa-teresa/outside", [], counts({ readingBooks: 142 })).state).toBe("full");
    // Outside has no milestones or books of its own.
    expect(scenePlan("santa-teresa/outside", [], counts({ readingBooks: 20 }))).toMatchObject({ milestones: [], books: 0, covers: 0 });
  });

  it("the Flamengo match is full at 4 weekly reviews (none yet: reviews aren't built)", () => {
    expect(FLAMENGO_FULL_WEEKLY_REVIEWS).toBe(4);
    expect(scenePlan("flamengo-match/inside", [], counts({ weeklyReviews: 3 })).state).toBe("start");
    expect(scenePlan("flamengo-match/inside", [], counts({ weeklyReviews: 4 })).state).toBe("full");
    expect(scenePlan("flamengo-match/outside", [], counts({ weeklyReviews: 4 })).state).toBe("full");
    expect(rioCounts(new Map([["weekly-reviews", 5]]) as never).weeklyReviews).toBe(5);
  });

  it("the Quilo stays quiet until recipes exist; Zona Sul stays at opening day until errands drive it", () => {
    expect(scenePlan("quilo/inside", [], counts({ monthlyGoals: 50, readingBooks: 50 })).state).toBe("start");
    expect(scenePlan("quilo/inside", [], counts({ recipes: 30 })).state).toBe("full");
    expect(scenePlan("zona-sul/inside", [], counts({ monthlyGoals: 50 })).state).toBe("start");
    expect(scenePlan("zona-sul/outside", [], zero).state).toBe("start");
  });

  it("with no counters (game not started, journal locked) every new area draws its start with no layers", () => {
    const none = rioCounts(null);
    for (const id of Object.keys(SCENES) as SceneId[]) {
      if (!/^(zona-sul|jardim-botanico|quilo|sult|os-esquilos|santa-teresa|flamengo-match)\//.test(id)) continue;
      expect(scenePlan(id, [], none), id).toEqual({ state: "start", celebrations: 0, milestones: [], books: 0, covers: 0 });
    }
  });
});
