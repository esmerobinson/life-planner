import { addDays, daysBetween, mondayOf, monthOf, weekdayOf, isValidISODate, todayISO } from "./dates";

describe("dates", () => {
  it("addDays crosses month and year", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("daysBetween is b minus a", () => {
    expect(daysBetween("2026-10-20", "2026-10-27")).toBe(7);
    expect(daysBetween("2026-10-27", "2026-10-20")).toBe(-7);
  });
  it("mondayOf goes back to Monday", () => {
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
  });
  it("weekdayOf", () => {
    expect(weekdayOf("2026-10-27")).toBe("tue");
    expect(weekdayOf("2026-10-25")).toBe("sun");
  });
  it("monthOf", () => {
    expect(monthOf("2026-12-31")).toBe("2026-12");
  });
  it("isValidISODate", () => {
    expect(isValidISODate("2026-13-45")).toBe(false);
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("2026-02-28")).toBe(true);
  });
  it("a day runs from 3am to 3am (Esme's choice): 1am and 2:59am count as yesterday", () => {
    expect(todayISO(new Date(2026, 10, 4, 1, 0))).toBe("2026-11-03");
    expect(todayISO(new Date(2026, 10, 4, 2, 59))).toBe("2026-11-03");
    expect(todayISO(new Date(2026, 10, 4, 3, 0))).toBe("2026-11-04");
    expect(todayISO(new Date(2026, 10, 4, 23, 59))).toBe("2026-11-04");
    expect(todayISO(new Date(2026, 0, 1, 2, 0))).toBe("2025-12-31");
  });

  it("todayISO is valid", () => {
    expect(isValidISODate(todayISO())).toBe(true);
  });
});
