import {
  EMPTY_FARM, arrivedRow, farmState, hiddenRow, outfitRow, placedRow, seenRow, spotRow, startRow, todayRow, validFarm, visitedRow,
} from "./state";

describe("validFarm", () => {
  it.each([
    ["start", startRow("dev-1", "2026-11-04")],
    ["seen", seenRow("seeds-mind", "2026-11-04")],
    ["placed", placedRow("hen", "hen", "2026-11-04")],
    ["arrived", arrivedRow("bap", "2026-11-05")],
    ["outfit", outfitRow("domino", "A1")],
    ["outfit (none)", outfitRow("domino", null)],
    ["today", todayRow("2026-11-04")],
    ["visited", visitedRow("lagoa-house", "2026-11-14")],
    ["visited (as written)", { id: "visited:lagoa-house", kind: "visited", area: "lagoa-house", date: "2026-11-14" }],
    ["with a stamp", { ...seenRow("hi", "2026-11-04"), updatedAt: 5 }],
    ["hidden", hiddenRow("hen", true, "2026-11-17")],
    ["hidden (shown again)", hiddenRow("hen", false, "2026-11-18")],
    ["hidden (as written)", { id: "hidden:hen", kind: "hidden", sticker: "hen", hidden: true, date: "2026-11-17" }],
    ["spot", spotRow("hen", "hen-2", "2026-11-17")],
    ["spot (as written, an underscore slot id)", { id: "spot:seeds-mind", kind: "spot", sticker: "seeds-mind", slot: "bed_mind_3", date: "2026-11-17" }],
  ])("accepts a %s row", (_n, row) => {
    expect(validFarm(row)).toBe(true);
  });

  it.each([
    ["not an object", "seen:hi"],
    ["kind not matching the id", { id: "seen:hi", kind: "placed", sticker: "hi", spot: "hi", date: "2026-11-04" }],
    ["sticker not matching the id", { id: "seen:hi", kind: "seen", sticker: "door", date: "2026-11-04" }],
    ["a bad date", { id: "seen:hi", kind: "seen", sticker: "hi", date: "2026-13-40" }],
    ["an unknown kind", { id: "coins:all", kind: "coins", date: "2026-11-04" }],
    ["an unknown character", { id: "arrived:biscuit", kind: "arrived", character: "biscuit", date: "2026-11-04" }],
    ["a made-up accessory", { id: "outfit:bap", kind: "outfit", character: "bap", item: "crown!" }],
    ["an extra field", { ...seenRow("hi", "2026-11-04"), note: "x" }],
    ["a today row for another day", { id: "today:2026-11-04", kind: "today", date: "2026-11-05" }],
    ["a bad stamp", { ...seenRow("hi", "2026-11-04"), updatedAt: -1 }],
    ["an upper-case sticker key", { id: "seen:Hi", kind: "seen", sticker: "Hi", date: "2026-11-04" }],
    ["a visited row whose id names another area", { id: "visited:fazenda", kind: "visited", area: "lagoa-house", date: "2026-11-14" }],
    ["a visited row with a bad area key", { id: "visited:Lagoa House", kind: "visited", area: "Lagoa House", date: "2026-11-14" }],
    ["a visited row with an extra field", { ...visitedRow("lagoa-house", "2026-11-14"), note: "x" }],
    ["a visited row with a bad date", { id: "visited:lagoa-house", kind: "visited", area: "lagoa-house", date: "2026-02-30" }],
    ["a hidden row whose id names another sticker", { id: "hidden:cow", kind: "hidden", sticker: "hen", hidden: true, date: "2026-11-17" }],
    ["a hidden row that isn't true or false", { id: "hidden:hen", kind: "hidden", sticker: "hen", hidden: "yes", date: "2026-11-17" }],
    ["a hidden row with no date", { id: "hidden:hen", kind: "hidden", sticker: "hen", hidden: true }],
    ["a hidden row with an extra field", { ...hiddenRow("hen", true, "2026-11-17"), note: "x" }],
    ["a spot row whose id names another sticker", { id: "spot:cow", kind: "spot", sticker: "hen", slot: "hen-2", date: "2026-11-17" }],
    ["a spot row with a bad slot id", { id: "spot:hen", kind: "spot", sticker: "hen", slot: "Hen 2!", date: "2026-11-17" }],
    ["a spot row with no slot", { id: "spot:hen", kind: "spot", sticker: "hen", date: "2026-11-17" }],
    ["a spot row with an extra field", { ...spotRow("hen", "hen-2", "2026-11-17"), scene: "fazenda/outside" }],
  ])("refuses %s", (_n, row) => {
    expect(validFarm(row)).toBe(false);
  });
});

describe("farmState", () => {
  it("is empty before the farm opens", () => {
    const s = farmState([]);
    expect(s.start).toBeNull();
    expect(s.seen.size).toBe(0);
    expect(s.visited.size).toBe(0);
    expect(EMPTY_FARM.visited.size).toBe(0);
  });

  it("starts on the EARLIEST device's start (a later device never moves it later)", () => {
    const s = farmState([startRow("phone", "2026-11-09"), startRow("mac", "2026-11-04"), startRow("ipad", "2026-12-01")]);
    expect(s.start).toBe("2026-11-04");
  });

  it("reads seen, placed, arrived, outfits and finished Today days", () => {
    const s = farmState([
      seenRow("hi", "2026-11-04"),
      placedRow("hen", "hen", "2026-11-05"),
      arrivedRow("bap", "2026-11-05"),
      outfitRow("bap", "H4"),
      outfitRow("domino", null),
      todayRow("2026-11-06"),
      todayRow("2026-11-04"),
      { id: "junk", kind: "seen" },
    ]);
    expect([...s.seen]).toEqual(["hi"]);
    expect(s.placed.get("hen")).toBe("hen");
    expect(s.arrived.has("bap")).toBe(true);
    expect(s.outfits.get("bap")).toBe("H4");
    expect(s.outfits.get("domino")).toBeNull();
    expect(s.todayDone).toEqual(["2026-11-04", "2026-11-06"]);
  });

  it("visited rows fill `visited` and change nothing else (review focus 4)", () => {
    const phase1 = [
      startRow("mac", "2026-11-04"), seenRow("hi", "2026-11-04"), placedRow("hen", "hen", "2026-11-05"),
      arrivedRow("bap", "2026-11-05"), outfitRow("bap", "H4"), todayRow("2026-11-06"),
    ];
    const before = farmState(phase1);
    const after = farmState([...phase1, visitedRow("lagoa-house", "2026-11-14"), visitedRow("fazenda", "2026-11-15"),
      { id: "visited:Bad", kind: "visited", area: "Bad", date: "2026-11-14" }]);
    const { visited: _v1, ...rest1 } = before;
    const { visited, ...rest2 } = after;
    expect(rest2).toEqual(rest1);
    expect([...visited].sort()).toEqual(["fazenda", "lagoa-house"]);
  });

  it("hidden and spot rows fill `hidden` and `spots` and change nothing else (Esme, 2026-11-17: move or hide, never lose)", () => {
    const phase1 = [startRow("mac", "2026-11-04"), seenRow("hen", "2026-11-04"), placedRow("hen", "rio", "2026-11-05"), placedRow("cow", "rio", "2026-11-05")];
    const before = farmState(phase1);
    const after = farmState([...phase1, hiddenRow("hen", true, "2026-11-17"), hiddenRow("cow", false, "2026-11-17"), spotRow("cow", "cow-2", "2026-11-17"),
      { id: "hidden:Bad", kind: "hidden", sticker: "Bad", hidden: true, date: "2026-11-17" }]);
    const { hidden: _h1, spots: _s1, ...rest1 } = before;
    const { hidden, spots, ...rest2 } = after;
    expect(rest2).toEqual(rest1);
    expect([...hidden]).toEqual(["hen"]); // cow was shown again: not hidden
    expect([...spots]).toEqual([["cow", "cow-2"]]);
    // Hidden stays earned and placed: nothing is taken away.
    expect(after.placed.has("hen")).toBe(true);
    expect(EMPTY_FARM.hidden.size).toBe(0);
    expect(EMPTY_FARM.spots.size).toBe(0);
  });

  it("keeps the day each sticker went into the collection (the Noticeboard's 'Just earned')", () => {
    const s = farmState([seenRow("hi", "2026-11-04"), seenRow("hen", "2026-11-06"), placedRow("cow", "rio", "2026-11-07")]);
    expect(s.seenOn.get("hi")).toBe("2026-11-04");
    expect(s.seenOn.get("hen")).toBe("2026-11-06");
    expect(s.seenOn.has("cow")).toBe(false);
    expect(EMPTY_FARM.seenOn.size).toBe(0);
  });
});
