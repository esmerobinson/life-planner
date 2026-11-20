import { describe, expect, it } from "vitest";
import { CITIES, placeFor, sunsetUtc } from "../../../src/due/sun";

const MIN = 60_000;
/** Minutes between two instants. */
const off = (a: number, b: number) => Math.abs(a - b) / MIN;

/**
 * An independent check: Wikipedia's "sunrise equation" (a simpler, ~1-minute formula), so the
 * NOAA maths is compared against something that isn't itself.
 */
function wikipediaSunset(date: string, lat: number, lon: number): number {
  const rad = Math.PI / 180;
  const jdNoon = Date.parse(`${date}T12:00:00Z`) / 86_400_000 + 2440587.5;
  const n = Math.round(jdNoon - 2451545.0); // the date's Julian day number since J2000
  const jStar = n - lon / 360;
  const m = (357.5291 + 0.98560028 * jStar) % 360;
  const c = 1.9148 * Math.sin(m * rad) + 0.02 * Math.sin(2 * m * rad) + 0.0003 * Math.sin(3 * m * rad);
  const lambda = (m + c + 180 + 102.9372) % 360;
  const transit = 2451545.0 + jStar + 0.0053 * Math.sin(m * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const sinD = Math.sin(lambda * rad) * Math.sin(23.4397 * rad);
  const cosD = Math.cos(Math.asin(sinD));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinD) / (Math.cos(lat * rad) * cosD);
  const set = transit + Math.acos(cosW) / rad / 360;
  return (set - 2440587.5) * 86_400_000;
}

describe("Due reminders: sunset (NOAA)", () => {
  it("New York City, 20 November 2026: about 16:33 EST", () => {
    const { lat, lon } = CITIES.nyc;
    const t = sunsetUtc("2026-11-20", lat, lon)!;
    expect(off(t, Date.parse("2026-11-20T16:33:00-05:00"))).toBeLessThanOrEqual(2);
  });

  it("New York City, midsummer: about 20:31 EDT", () => {
    const { lat, lon } = CITIES.nyc;
    expect(off(sunsetUtc("2026-06-21", lat, lon)!, Date.parse("2026-06-21T20:31:00-04:00"))).toBeLessThanOrEqual(2);
  });

  it("London, midsummer 21:21 BST and midwinter 15:53 GMT", () => {
    const { lat, lon } = CITIES.london;
    expect(off(sunsetUtc("2026-06-21", lat, lon)!, Date.parse("2026-06-21T21:21:00+01:00"))).toBeLessThanOrEqual(2);
    expect(off(sunsetUtc("2026-12-21", lat, lon)!, Date.parse("2026-12-21T15:53:00Z"))).toBeLessThanOrEqual(2);
  });

  it("Rio de Janeiro (southern hemisphere, west of Greenwich): in the evening, as the sunrise equation says", () => {
    const { lat, lon } = CITIES.rio;
    for (const date of ["2026-11-20", "2026-06-21", "2026-12-21"]) {
      const t = sunsetUtc(date, lat, lon)!;
      expect(off(t, wikipediaSunset(date, lat, lon))).toBeLessThanOrEqual(2);
    }
    // Late November in Rio the sun sets around 18:15 (UTC-3).
    expect(off(sunsetUtc("2026-11-20", lat, lon)!, Date.parse("2026-11-20T18:15:00-03:00"))).toBeLessThanOrEqual(6);
  });

  it("far east of Greenwich the sunset still falls on the date asked (Tokyo, Sydney)", () => {
    const tokyo = sunsetUtc("2026-11-20", 35.68, 139.69)!;
    expect(new Date(tokyo + 9 * 3_600_000).toISOString().slice(0, 13)).toBe("2026-11-20T16");
    const sydney = sunsetUtc("2026-11-20", -33.87, 151.21)!;
    expect(new Date(sydney + 11 * 3_600_000).toISOString().slice(0, 10)).toBe("2026-11-20");
    expect(off(sydney, wikipediaSunset("2026-11-20", -33.87, 151.21))).toBeLessThanOrEqual(2);
  });

  it("no sunset in the polar night or the midnight sun: null", () => {
    expect(sunsetUtc("2026-12-21", 78.22, 15.65)).toBeNull();
    expect(sunsetUtc("2026-06-21", 78.22, 15.65)).toBeNull();
  });

  it("the place: hers when set, else from her time zone, else none", () => {
    expect(placeFor({ timeZone: "America/New_York" })).toEqual(CITIES.nyc);
    expect(placeFor({ timeZone: "America/Sao_Paulo" })).toEqual(CITIES.rio);
    expect(placeFor({ timeZone: "Europe/London" })).toEqual(CITIES.london);
    expect(placeFor({ timeZone: "Asia/Tokyo" })).toBeNull();
    expect(placeFor({ timeZone: "America/New_York", lat: 51.5, lon: -0.1 })).toEqual({ lat: 51.5, lon: -0.1 });
    // Half a place isn't one.
    expect(placeFor({ timeZone: "Asia/Tokyo", lat: 51.5 })).toBeNull();
  });
});
