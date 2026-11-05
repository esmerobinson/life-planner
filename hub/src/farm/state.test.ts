import {
  arrivedRow, farmState, outfitRow, placedRow, seenRow, startRow, todayRow, validFarm,
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
    ["with a stamp", { ...seenRow("hi", "2026-11-04"), updatedAt: 5 }],
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
  ])("refuses %s", (_n, row) => {
    expect(validFarm(row)).toBe(false);
  });
});

describe("farmState", () => {
  it("is empty before the farm opens", () => {
    const s = farmState([]);
    expect(s.start).toBeNull();
    expect(s.seen.size).toBe(0);
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
});
