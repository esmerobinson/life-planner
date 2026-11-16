import { areaStatuses } from "./areas";
import { nextFriend, nextOpening, recentStickers } from "./notices";

// The Noticeboard says only what is true today: which place opens next and when, what she earned
// lately, and who moves in next. (Bundles, the stuck task and themed nights come in phase 2.)

describe("the next place to open", () => {
  it("day 1: the Barraca opens on day 3, two days from now", () => {
    const n = nextOpening(areaStatuses(1, new Set()), "2026-11-16", "2026-11-16");
    expect(n).toEqual({ key: "barraca", name: "Barraca", day: 3, date: "2026-11-18", inDays: 2 });
  });

  it("day 3: the clothing store, on day 5", () => {
    expect(nextOpening(areaStatuses(3, new Set()), "2026-11-16", "2026-11-18")).toMatchObject({ key: "clothing-store", day: 5, inDays: 2 });
  });

  it("once every place with art is open there is nothing to announce", () => {
    expect(nextOpening(areaStatuses(400, new Set()), "2026-01-01", "2027-02-04")).toBeNull();
  });

  it("before the game has started there is no date to give", () => {
    expect(nextOpening(areaStatuses(1, new Set()), null, "2026-11-16")).toBeNull();
  });
});

describe("just earned", () => {
  it("newest first, then book order, at most five", () => {
    const seenOn = new Map([
      ["hi", "2026-11-01"], ["hen", "2026-11-05"], ["cow", "2026-11-05"], ["daisy", "2026-11-03"],
      ["lilypad", "2026-11-04"], ["seeds-mind", "2026-11-02"],
    ]);
    const keys = recentStickers(seenOn);
    expect(keys).toHaveLength(5);
    expect(keys.slice(0, 2).sort()).toEqual(["cow", "hen"]);
    expect(keys.indexOf("hen") < keys.indexOf("cow")).toBe(true); // book order: hen before cow
    expect(keys[2]).toBe("lilypad");
    expect(keys).not.toContain("hi");
  });

  it("nothing earned yet: an empty list", () => {
    expect(recentStickers(new Map())).toEqual([]);
  });
});

describe("the next friend", () => {
  it("Bap moves in at 5 stickers or on day 5, whichever comes first", () => {
    expect(nextFriend(3, 2, new Set(["domino"]))).toEqual({ id: "bap", name: "Bap", at: 5, stickersToGo: 2, daysToGo: 3 });
  });

  it("skips friends who have already moved in", () => {
    expect(nextFriend(6, 6, new Set(["domino", "bap"]))).toMatchObject({ id: "puddle" });
  });

  it("everyone has moved in: no one to announce", () => {
    expect(nextFriend(200, 200, new Set(["domino", "bap", "puddle", "clover", "crumpet", "duvet"]))).toBeNull();
  });
});
