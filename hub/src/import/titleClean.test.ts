import { describe, expect, it } from "vitest";
import { cleanTitle, unwikilink } from "./titleClean";
import { parseBacklog } from "./backlog";

describe("unwikilink", () => {
  it.each([
    ["[[Content Studio|carousel]] idea", "carousel idea"],
    ["Plan [[Art - Home]] week", "Plan Art - Home week"],
    ["[[[[Art - Home|Art]] - Home|Art]] session", "Art session"],
    ["[[Page#Heading|shown]] and [[Other#Part]]", "shown and Other"],
    ["[[A|B|C]]", "C"],
    ["stray [[ open and close ]] marks]]", "stray open and close marks"],
    ["no links here", "no links here"],
    ["[[]]", ""],
  ])("%s -> %s", (raw, want) => {
    expect(unwikilink(raw).replace(/\s+/g, " ").trim()).toBe(want);
  });

  it("never throws on odd input", () => {
    for (const s of ["[[", "]]", "[[[[[[", "[[a|]]", "[[|a]]", "][", "[[a]]]]"]) {
      expect(() => unwikilink(s)).not.toThrow();
    }
  });
});

describe("cleanTitle", () => {
  it("strips a trailing (from Google Tasks), case-insensitively", () => {
    expect(cleanTitle("Buy stamps (from Google Tasks)")).toEqual({ title: "Buy stamps", notes: [] });
    expect(cleanTitle("Buy stamps (FROM google tasks)").title).toBe("Buy stamps");
  });

  it("strips overdue, due today, due in Nd and carried suffixes", () => {
    expect(cleanTitle("Task (due today)")).toEqual({ title: "Task", notes: [] });
    expect(cleanTitle("Task (due in 1d)")).toEqual({ title: "Task", notes: [] });
    expect(cleanTitle("Task (due in 12d)")).toEqual({ title: "Task", notes: [] });
    expect(cleanTitle("Task (carried from 3 Aug)")).toEqual({ title: "Task", notes: [] });
    expect(cleanTitle("Task (carried)")).toEqual({ title: "Task", notes: [] });
  });

  it("keeps the date information from overdue and was-due suffixes as notes", () => {
    expect(cleanTitle("Task (overdue!)")).toEqual({ title: "Task", notes: ["Was overdue on import"] });
    expect(cleanTitle("Task (was due 19 Jul)")).toEqual({ title: "Task", notes: ["Was due 19 Jul"] });
    expect(cleanTitle("Task (WAS DUE 3 Sep 2026)")).toEqual({ title: "Task", notes: ["Was due 3 Sep 2026"] });
  });

  it("strips several suffixes in a row, in any order", () => {
    const r = cleanTitle("Task (from Google Tasks) (overdue!) (due in 2d) (was due 1 Jun)");
    expect(r.title).toBe("Task");
    expect(r.notes.sort()).toEqual(["Was due 1 Jun", "Was overdue on import"]);
    expect(cleanTitle("Task (due today) (from Google Tasks)").title).toBe("Task");
  });

  it("keeps parentheses that are part of the title", () => {
    expect(cleanTitle("Call Sam (about the lease)").title).toBe("Call Sam (about the lease)");
    expect(cleanTitle("Plan (due soon) later").title).toBe("Plan (due soon) later");
  });

  it("turns wiki-links into text and collapses whitespace", () => {
    expect(cleanTitle("  [[[[Art - Home|Art]] - Home|Art]]   session  ").title).toBe("Art session");
    expect(cleanTitle("Make [[Content Studio|carousel]] (overdue!)")).toEqual({
      title: "Make carousel",
      notes: ["Was overdue on import"],
    });
  });
});

describe("parseBacklog uses the cleanup", () => {
  const md = [
    "## Active",
    "- [ ] Water the plants (overdue!) [due 2026-10-01] #home",
    "- [ ] Call [[Sam Example|Sam]] (was due 19 Jul)",
    "- [ ] Draft [[[[Art - Home|Art]] - Home|Art]] session",
  ].join("\n");

  it("cleans titles, keeps the notes, and keys on the cleaned title", () => {
    const { items } = parseBacklog(md);
    expect(items.map((i) => i.title)).toEqual(["Water the plants", "Call Sam", "Draft Art session"]);
    expect(items[0]).toMatchObject({ key: "backlog:water the plants", notes: "Was overdue on import", due: "2026-10-01", tags: ["home"] });
    expect(items[1].notes).toBe("Was due 19 Jul");
    expect(items[2].notes).toBeUndefined();
  });

  it("merges copies of the same task (same normalised title) and reports them", () => {
    const dup = [
      "## Inbox (to triage)",
      "- [ ] Buy stamps (from Google Tasks) #errands",
      "- [ ] Pay rent (due today)",
      "## Life admin",
      "- [ ] Buy stamps [due 2026-11-02] #post",
      "- [ ] Pay rent (due in 3d) (was due 2 Oct)",
      "- [ ] Pay rent (overdue!)",
    ].join("\n");
    const { items, merged } = parseBacklog(dup);
    expect(items.map((i) => i.title)).toEqual(["Buy stamps", "Pay rent"]);
    const stamps = items[0];
    // the real section wins over the inbox copy; tags, due and notes are merged
    expect(stamps.section).toBe("Life admin");
    expect(stamps.tags.sort()).toEqual(["errands", "post"]);
    expect(stamps.due).toBe("2026-11-02");
    const rent = items[1];
    expect(rent.section).toBe("Life admin");
    expect(rent.notes?.split("\n").sort()).toEqual(["Was due 2 Oct", "Was overdue on import"]);
    expect(merged).toEqual([
      { title: "Buy stamps", section: "Life admin" },
      { title: "Pay rent", section: "Life admin" },
      { title: "Pay rent", section: "Life admin" },
    ]);
  });

  it("copies that differ only by case, spacing or punctuation are one task", () => {
    const { items, merged } = parseBacklog("## Active\n- [ ] Call  Sam!\n- [ ] call sam\n- [ ] Call Sam.");
    expect(items).toHaveLength(1);
    expect(merged).toHaveLength(2);
  });
});
