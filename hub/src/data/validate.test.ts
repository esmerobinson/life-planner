import { describe, expect, it } from "vitest";
import { validItem } from "./validate";

const row = (o: Record<string, unknown> = {}) => ({
  id: "i1", kind: "task", title: "Pretend", links: [], areaId: "art", priority: 2,
  status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01", ...o,
});

describe("round 3 item fields", () => {
  it("rows without the new fields stay valid (older rows and older devices)", () => {
    expect(validItem(row())).toBe(true);
  });

  it("milestone is an optional boolean", () => {
    expect(validItem(row({ milestone: true }))).toBe(true);
    expect(validItem(row({ milestone: false }))).toBe(true);
    expect(validItem(row({ milestone: "yes" }))).toBe(false);
  });

  it("order is an optional finite number", () => {
    expect(validItem(row({ order: 0 }))).toBe(true);
    expect(validItem(row({ order: 3.5 }))).toBe(true);
    expect(validItem(row({ order: "1" }))).toBe(false);
    expect(validItem(row({ order: Number.NaN }))).toBe(false);
  });

  it("doneDates is an optional list of real dates, at most 400", () => {
    expect(validItem(row({ doneDates: ["2026-10-27", "2026-10-28"] }))).toBe(true);
    expect(validItem(row({ doneDates: [] }))).toBe(true);
    expect(validItem(row({ doneDates: ["2026-02-30"] }))).toBe(false);
    expect(validItem(row({ doneDates: "2026-10-28" }))).toBe(false);
    expect(validItem(row({ doneDates: Array.from({ length: 401 }, () => "2026-10-28") }))).toBe(false);
  });
});
