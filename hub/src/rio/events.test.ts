import { activeEvent, rioDate } from "./events";

// Holiday takeovers on the map (map.json events), in Rio time (UTC-3, no daylight saving),
// read the same on a device in any time zone.

const at = (iso: string) => activeEvent(new Date(iso))?.key ?? null;

describe("the map's holiday takeovers", () => {
  it("rioDate reads the month-day and hour in Rio", () => {
    expect(rioDate(new Date("2027-02-01T02:59:00Z"))).toEqual({ md: "01-31", hour: 23 });
    expect(rioDate(new Date("2027-02-01T03:00:00Z"))).toEqual({ md: "02-01", hour: 0 });
  });

  it("Carnaval: 1 to 15 February, Rio time", () => {
    expect(at("2027-02-01T02:59:00Z")).toBeNull(); // 31 Jan 23:59 in Rio
    expect(at("2027-02-01T03:00:00Z")).toBe("carnaval");
    expect(at("2027-02-10T15:00:00Z")).toBe("carnaval");
    expect(at("2027-02-16T02:59:00Z")).toBe("carnaval"); // 15 Feb 23:59 in Rio
    expect(at("2027-02-16T03:00:00Z")).toBeNull();
    expect(at("2027-01-31T12:00:00Z")).toBeNull();
    expect(at("2027-03-10T12:00:00Z")).toBeNull();
  });

  it("Réveillon: all of 31 December (map.json), and its night until 06:00 on 1 January", () => {
    expect(at("2026-12-30T12:00:00Z")).toBeNull();
    expect(at("2026-12-31T03:00:00Z")).toBe("reveillon"); // 00:00 on 31 Dec in Rio
    expect(at("2026-12-31T21:00:00Z")).toBe("reveillon"); // 18:00
    expect(at("2027-01-01T08:59:00Z")).toBe("reveillon"); // 05:59 on 1 Jan
    expect(at("2027-01-01T09:00:00Z")).toBeNull(); // 06:00
    expect(at("2027-01-01T15:00:00Z")).toBeNull();
  });
});
