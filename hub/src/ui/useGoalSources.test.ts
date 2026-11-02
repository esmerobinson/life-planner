import { describe, expect, it } from "vitest";
import { touchesJournal } from "./useGoalSources";

describe("useGoalSources re-reads only for the journal or the key (review M8)", () => {
  it("journal and syncMeta parts re-read; items, goals, pending and files don't", () => {
    expect(touchesJournal("idb://life-hub/journal/")).toBe(true);
    expect(touchesJournal("idb://life-hub/journal/date")).toBe(true);
    expect(touchesJournal("idb://life-hub/syncMeta/")).toBe(true);
    expect(touchesJournal("idb://life-hub/items/")).toBe(false);
    expect(touchesJournal("idb://life-hub/goals/:dels")).toBe(false);
    expect(touchesJournal("idb://life-hub/pending/")).toBe(false);
    expect(touchesJournal("idb://life-hub/journalish/")).toBe(false);
  });
});
