import { SET_UNITS, STICKERS, STICKER_BY_KEY, captionFor, isSurprise } from "./catalogue";
import { allEarned, counters, type Counters } from "./earning";
import { textWidth } from "./sprites";
import { farmState } from "./state";
import { slotCard } from "./StickerBook";
import { PAGES } from "./world";

// Captions in the sticker book (Esme, 2026-11-06: "you can use a pretty small font to add a caption
// under every sticker"): a short caption under every sticker, earned or not; one "what it counts"
// line per set; the card says how close she is or when she got it. Kind notes stay a surprise.

const PAGE_INNER = { left: [11, 108], right: [7, 104] } as const; // inside the page's frame lines
const SLOT = 19;

describe("captions under every sticker", () => {
  it("every sticker has one, except the Kind notes (a surprise)", () => {
    for (const s of STICKERS) {
      if (isSurprise(s)) expect(captionFor(s)).toBeNull();
      else expect(captionFor(s)).toMatch(/^[0-9A-Z/]+$/);
    }
    expect(STICKERS.filter(isSurprise)).toHaveLength(8);
  });

  it("say the target: numbers, or a short word where there's no number", () => {
    const cap = (k: string) => captionFor(STICKER_BY_KEY.get(k)!);
    expect(cap("seeds-mind")).toBe("1");
    expect(cap("hen")).toBe("1");
    expect(cap("full-month")).toBe("ALL");
    expect(cap("oak-6")).toBe("6MO");
    expect(cap("oak-12")).toBe("9/12");
    expect(cap("cleared-production")).toBe("PROD");
    const months = STICKERS.filter((s) => s.set === "Hedgerow").map((s) => captionFor(s));
    expect(months).toEqual(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]);
  });

  it("fit under their slot in the pixel font (the Bonus page's slots are wider)", () => {
    for (const page of PAGES) {
      const xs = [...new Set(page.slots.map((s) => s.x))].sort((a, b) => a - b);
      const pitch = xs.length > 1 ? xs[1]! - xs[0]! : SLOT;
      for (const slot of page.slots) {
        const c = captionFor(STICKER_BY_KEY.get(slot.sticker)!);
        if (c) expect(textWidth(c), `${slot.sticker} "${c}"`).toBeLessThanOrEqual(pitch - 1);
      }
    }
  });
});

describe("the re-spaced book", () => {
  it("every set has its one line, and it fits inside the page", () => {
    for (const page of PAGES) {
      const [, right] = PAGE_INNER[page.side];
      for (const label of page.labels) {
        const unit = SET_UNITS[label.set];
        expect(unit, label.set).toBeTruthy();
        expect(label.unit_x + textWidth(unit!), label.set).toBeLessThanOrEqual(right);
        expect(label.unit_y).toBe(label.y + 8);
      }
    }
  });

  it("leaves room for each caption: rows 27px apart, nothing below the page number line", () => {
    for (const page of PAGES) {
      const [left, right] = PAGE_INNER[page.side];
      for (const slot of page.slots) {
        expect(slot.x).toBeGreaterThanOrEqual(left);
        expect(slot.x + SLOT).toBeLessThanOrEqual(right + 1);
        expect(slot.y + 20 + 5, `${slot.sticker} caption`).toBeLessThanOrEqual(136);
        for (const other of page.slots) {
          if (other === slot || other.x !== slot.x || other.y <= slot.y) continue;
          expect(other.y - slot.y).toBeGreaterThanOrEqual(27);
        }
      }
      // A set's heading sits below the captions of the set above it.
      const tops = page.labels.map((l) => l.y).sort((a, b) => a - b);
      for (let i = 1; i < tops.length; i++) {
        const above = page.slots.filter((s) => s.y < tops[i]!).map((s) => s.y + 25);
        expect(Math.max(...above)).toBeLessThan(tops[i]! - 1);
      }
    }
  });

  it("every page holds one zone, and every sticker has exactly one slot", () => {
    for (const page of PAGES) expect(new Set(page.slots.map((s) => STICKER_BY_KEY.get(s.sticker)!.group))).toEqual(new Set([page.group]));
    expect(PAGES.flatMap((p) => p.slots.map((s) => s.sticker)).sort()).toEqual(STICKERS.map((s) => s.key).sort());
  });
});

describe("the sticker's card", () => {
  const view = (c: Record<string, number> | null, rows: unknown[] = []) => ({
    counters: (c ? new Map(Object.entries(c)) : null) as Counters | null,
    state: farmState(rows),
  });

  it("a sticker not earned yet: what it's for and how close she is", () => {
    const card = slotCard("chick", "ghost", view({ "habit-sessions": 6 }));
    expect(card).toEqual({ title: "Chick", hint: "10 habit sessions", progress: "6 of 10 so far" });
    expect(slotCard("chick", "ghost", view({ "habit-sessions": 40 })).progress).toBe("10 of 10 so far");
  });

  it("no progress line where there's nothing to count towards", () => {
    expect(slotCard("hen", "ghost", view({ "habit-sessions": 0 })).progress).toBeNull(); // the first one
    expect(slotCard("oak-12", "ghost", view({ "habit-year": 0 })).progress).toBeNull();
    expect(slotCard("teapot", "ghost", view({})).progress).toBeNull(); // reviews aren't built yet
    expect(slotCard("lilypad", "ghost", view(null)).progress).toBeNull(); // the farm hasn't started
  });

  it("an earned sticker says when she got it", () => {
    const rows = [
      { id: "seen:chick", kind: "seen", sticker: "chick", date: "2026-11-05", updatedAt: 1 },
      { id: "placed:chick", kind: "placed", sticker: "chick", spot: "chick", date: "2026-11-03", updatedAt: 2 },
    ];
    const card = slotCard("chick", "placed", view({}, rows));
    expect(card.title).toBe("Chick");
    expect(card.progress).toBe("Earned 3 Nov");
  });

  it("a Kind note stays a surprise until it's earned, then says what it was for", () => {
    const welcomeBack = STICKERS.find((s) => s.set === "Kind notes" && s.rule.source === "returns" && s.rule.at === 1)!;
    expect(slotCard(welcomeBack.key, "ghost", view({ returns: 0 }))).toEqual({ title: "A surprise", hint: null, progress: null });
    const earned = slotCard(welcomeBack.key, "ready", view({ returns: 1 }));
    expect(earned.title).toBe(welcomeBack.name);
    expect(earned.hint).toBe("Coming back after a few days away");
  });
});

describe("the sticker swap (Art session, 2026-11-06)", () => {
  it("the five stickers that went are gone, and old rows for them are quietly ignored", () => {
    const gone = ["seedtray", "pebble", "steppingstone", "lantern", "ribbon"];
    for (const k of gone) expect(STICKER_BY_KEY.has(k)).toBe(false);
    const state = farmState(gone.map((k) => ({ id: `seen:${k}`, kind: "seen", sticker: k, date: "2026-11-05", updatedAt: 1 })));
    const c = counters({ start: "2026-11-05", today: "2026-11-07", items: [], goals: [], todayDone: [], journal: null });
    expect(allEarned(c, state.seen, state.placed)).toEqual(allEarned(c, new Set(), new Map()));
  });

  it("the five new barnyard friends are in their sets, still 175 in all", () => {
    expect(STICKERS.filter((s) => s.set === "Animals").map((s) => s.key).slice(-3)).toEqual(["horse", "goat", "rooster"]);
    expect(STICKERS.filter((s) => s.set === "Barn things").map((s) => s.key).slice(-2)).toEqual(["barn-cat", "owl"]);
    expect(STICKERS.filter((s) => !s.bonus)).toHaveLength(175);
  });
});
