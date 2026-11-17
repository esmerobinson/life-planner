import { describe, expect, it } from "vitest";
import { appDay, instantOf, isoInZone, isTimeZone, parseDueAt, settingsInstant, wallClock, weekdayOf } from "../../../src/due/time";

const NY = "America/New_York";

describe("Due reminders: her time zone", () => {
  it("reads the wall clock in her zone, winter and summer", () => {
    expect(wallClock(Date.parse("2026-11-16T20:00:00Z"), NY)).toEqual({ date: "2026-11-16", time: "15:00" });
    expect(wallClock(Date.parse("2026-07-01T20:00:00Z"), NY)).toEqual({ date: "2026-07-01", time: "16:00" });
    expect(wallClock(Date.parse("2026-11-16T20:00:00Z"), "America/Sao_Paulo")).toEqual({ date: "2026-11-16", time: "17:00" });
  });

  it("the day ends at 3am in her zone, not at UTC midnight", () => {
    // 02:59 New York on the 17th is still the 16th; 03:00 is the 17th.
    expect(appDay(Date.parse("2026-11-17T07:59:00Z"), NY)).toBe("2026-11-16");
    expect(appDay(Date.parse("2026-11-17T08:00:00Z"), NY)).toBe("2026-11-17");
    // 23:30 New York is already the next day in UTC, still the 16th for her.
    expect(appDay(Date.parse("2026-11-17T04:30:00Z"), NY)).toBe("2026-11-16");
  });

  it("turns her wall clock into an instant, across clock changes", () => {
    expect(instantOf("2026-11-16", "09:00", NY)).toBe(Date.parse("2026-11-16T14:00:00Z"));
    expect(instantOf("2026-07-01", "09:00", NY)).toBe(Date.parse("2026-07-01T13:00:00Z"));
    // The day the clocks go back (1 Nov 2026): 09:00 is already standard time.
    expect(instantOf("2026-11-01", "09:00", NY)).toBe(Date.parse("2026-11-01T14:00:00Z"));
  });

  it("a settings time before 3am goes off after midnight, at the end of its day", () => {
    expect(settingsInstant("2026-11-16", "01:30", NY)).toBe(Date.parse("2026-11-17T06:30:00Z"));
    expect(settingsInstant("2026-11-16", "21:00", NY)).toBe(Date.parse("2026-11-17T02:00:00Z"));
  });

  it("writes dueAt with her offset", () => {
    expect(isoInZone(Date.parse("2026-11-16T20:00:00Z"), NY)).toBe("2026-11-16T15:00:00-05:00");
    expect(isoInZone(Date.parse("2026-11-16T20:00:00Z"), "Asia/Kolkata")).toBe("2026-11-17T01:30:00+05:30");
  });

  it("reads Due's dueAt with or without a zone (without: US Eastern)", () => {
    expect(parseDueAt("2026-11-16T15:00:00")).toBe(Date.parse("2026-11-16T20:00:00Z"));
    expect(parseDueAt("2026-11-16T15:00:00-05:00")).toBe(Date.parse("2026-11-16T20:00:00Z"));
    expect(parseDueAt("2026-11-16T20:00:00.000Z")).toBe(Date.parse("2026-11-16T20:00:00Z"));
    expect(parseDueAt(42)).toBeNaN();
  });

  it("knows real zones and refuses made-up ones", () => {
    expect(isTimeZone(NY)).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });

  it("weekdays", () => {
    expect(weekdayOf("2026-11-16")).toBe("mon");
    expect(weekdayOf("2026-11-22")).toBe("sun");
  });
});
