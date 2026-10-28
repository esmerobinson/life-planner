import { describe, expect, it } from "vitest";
import { endOfMonth } from "../domain/dates";
import {
  buildObsidianRows,
  parseAreaGoals,
  parseHabits,
  parseMonthGoals,
  slug,
  type ProposedGoal,
} from "./obsidianGoals";
import goalsMd from "./__fixtures__/ObsidianGoals.md?raw";
import monthMd from "./__fixtures__/ObsidianMonth.md?raw";
import habitsMd from "./__fixtures__/ObsidianHabits.md?raw";

const TODAY = "2026-10-28";

describe("endOfMonth", () => {
  it("handles 30/31-day months and leap Februaries", () => {
    expect(endOfMonth(2028, 2)).toBe("2028-02-29");
    expect(endOfMonth(2027, 2)).toBe("2027-02-28");
    expect(endOfMonth(2026, 10)).toBe("2026-10-31");
    expect(endOfMonth(2026, 11)).toBe("2026-11-30");
    expect(endOfMonth(2026, 12)).toBe("2026-12-31");
  });
});

describe("slug", () => {
  it("lowercases, collapses and trims", () => {
    expect(slug("  Hello   World ")).toBe("hello world");
  });
});

describe("parseAreaGoals", () => {
  const { goals, notes } = parseAreaGoals(goalsMd, TODAY);
  const by = (t: string) => goals.find((g) => g.title === t)!;

  it("makes one goal per area section and ignores Notes and the intro", () => {
    expect(goals.map((g) => g.title)).toEqual([
      "Writing", "Creative technologist", "Art", "Production & freelance", "Inner work", "Health", "Gardening corner",
    ]);
    expect(notes).toEqual([]);
  });

  it("maps areas, falling back to admin for unmapped headings", () => {
    expect(by("Writing")).toMatchObject({ areaId: "writing", areaFallback: false });
    expect(by("Creative technologist").areaId).toBe("tech");
    expect(by("Production & freelance").areaId).toBe("production");
    expect(by("Inner work").areaId).toBe("mind");
    expect(by("Health").areaId).toBe("body");
    expect(by("Gardening corner")).toMatchObject({ areaId: "admin", areaFallback: true });
  });

  it("joins identity, cadence and study lines", () => {
    const w = by("Writing");
    expect(w.why).toBe("A person who finishes small pretend zines.\n\nSomeone who shares work before it feels ready.");
    expect(w.cadence).toBe("Weekly: 3 drafting sessions · 1 edit pass");
    expect(w.notes).toBe("Ada Example, Bo Sample, Cy Placeholder");
    expect(by("Creative technologist").cadence).toBe("Weekly: 2 build evenings\nDaily: 20 minutes of reading");
    expect(by("Production & freelance").cadence).toBe("Ongoing: Keep the pretend invoice tracker current");
    expect(by("Art").cadence).toBeUndefined();
    expect(by("Art").notes).toBeUndefined();
  });

  it("an area with only Identity lines is a practice goal with no milestones", () => {
    expect(by("Art")).toMatchObject({ kind: "practice", milestones: [], why: "Draws every week, café sketches included." });
    expect(by("Art").deadline).toBeUndefined();
  });

  it("markers become milestones; kind and deadline year follow the rules", () => {
    expect(by("Writing")).toMatchObject({
      kind: "finite",
      milestones: ["Publish 2 zines by 30 Jun 2027", "Reach 500 newsletter readers"],
      deadline: "2027-12-31",
    });
    // no year in the marker: the year of today
    expect(by("Creative technologist")).toMatchObject({ kind: "finite", deadline: "2026-12-31" });
    // a number with a comma is not a year
    expect(by("Production & freelance")).toMatchObject({ kind: "finite", deadline: "2028-12-31" });
  });

  it("keys are slugs of the title", () => {
    expect(by("Production & freelance").key).toBe("obsidian:goal:production & freelance");
  });

  it("cuts a long marker at 200 characters", () => {
    const r = parseAreaGoals(`## Writing\n- Marker: ${"x".repeat(300)}`, TODAY);
    expect(r.goals[0].milestones[0]).toHaveLength(200);
  });

  it("reports unrecognised lines and duplicate titles, and empty markers", () => {
    const r = parseAreaGoals("## Art\n- Surprise: hello\n- Marker:\n## Art\n- Identity: again", TODAY);
    expect(r.goals).toHaveLength(1);
    expect(r.notes.map((n) => n.reason).sort()).toEqual(
      ["duplicate area, skipped", "empty marker, skipped", "line not recognised"].sort(),
    );
  });

  it("CRLF gives the same result as LF", () => {
    expect(parseAreaGoals(goalsMd.replace(/\n/g, "\r\n"), TODAY)).toEqual(parseAreaGoals(goalsMd, TODAY));
  });

  it.each(["", "   ", "just some garbage\n\n* * *\n", "## \n- Identity: x", "\u0000￿", "# Goals"])(
    "never throws on %j",
    (text) => {
      expect(() => parseAreaGoals(text, TODAY)).not.toThrow();
    },
  );

  it("never throws on a non-string", () => {
    expect(parseAreaGoals(null as unknown as string, TODAY)).toEqual({ goals: [], notes: [] });
  });
});

describe("parseMonthGoals", () => {
  const r = parseMonthGoals(monthMd, TODAY);

  it("reads the month end, goals and next-step tasks", () => {
    expect(r.monthEnd).toBe("2028-02-29");
    expect(r.goals.map((g) => g.title)).toEqual([
      "Finish the pretend zine", "Tidy the invented studio", "Send three pretend pitches",
    ]);
    expect(r.goals[0]).toMatchObject({
      kind: "finite", areaId: "admin", areaFallback: true, deadline: "2028-02-29", milestones: [],
      notes: "Get the whole first draft down, rough is fine.",
      key: "obsidian:goal:finish the pretend zine",
    });
    expect(r.tasks).toHaveLength(3);
    expect(r.tasks[0]).toEqual({
      key: "obsidian:task:finish the pretend zine:write the ending scene",
      title: "Write the ending scene",
      areaId: "admin",
      goalKey: "obsidian:goal:finish the pretend zine",
    });
    expect(r.notes).toEqual([]);
  });

  it("ignores the other sections", () => {
    expect(r.goals.map((g) => g.title)).not.toContain("Not a goal");
  });

  it("a goal without a next step gets no task", () => {
    const x = parseMonthGoals("# Goals for March 2027\n## This month's goals\n*   **Solo goal:** desc", TODAY);
    expect(x.goals).toHaveLength(1);
    expect(x.tasks).toEqual([]);
    expect(x.monthEnd).toBe("2027-03-31");
  });

  it("without a readable month heading, uses the end of today's month and says so", () => {
    const x = parseMonthGoals("## This month's goals\n*   **Solo goal:** desc", TODAY);
    expect(x.monthEnd).toBeUndefined();
    expect(x.goals[0].deadline).toBe("2026-10-31");
    expect(x.notes.some((n) => /month/i.test(n.reason))).toBe(true);
  });

  it("an unknown month name is reported", () => {
    const x = parseMonthGoals("# Goals for Smarch 2027\n## This month's goals\n*   **G:** d", TODAY);
    expect(x.monthEnd).toBeUndefined();
    expect(x.notes.length).toBeGreaterThan(0);
  });

  it("CRLF matches LF; garbage and empty never throw", () => {
    expect(parseMonthGoals(monthMd.replace(/\n/g, "\r\n"), TODAY)).toEqual(r);
    for (const t of ["", "garbage", "## This month's goals\n*   no bold\n    *   Next step:", "# Goals for"]) {
      expect(() => parseMonthGoals(t, TODAY)).not.toThrow();
    }
    expect(parseMonthGoals("", TODAY).goals).toEqual([]);
  });

  it("accepts Next-step and Next steps labels", () => {
    const x = parseMonthGoals(
      "# Goals for May 2027\n## This month's goals\n*   **A goal:** d\n    *   Next-step: Do one\n*   **B goal:** d\n    *   Next steps: Do two",
      TODAY,
    );
    expect(x.tasks.map((t) => t.title)).toEqual(["Do one", "Do two"]);
    expect(x.notes).toEqual([]);
  });

  it("uses the first nested labelled line when its label is not Next step, and says so", () => {
    const x = parseMonthGoals(
      "# Goals for May 2027\n## This month's goals\n*   **A goal:** d\n    *   Try-first: Do one\n    *   Other-bit: ignored",
      TODAY,
    );
    expect(x.tasks.map((t) => t.title)).toEqual(["Do one"]);
    expect(x.notes).toHaveLength(1);
    expect(x.notes[0].reason).toMatch(/next step/i);
  });

  it("two goals whose titles differ only by a parenthetical both stay, with the full titles", () => {
    const x = parseMonthGoals(
      "# Goals for May 2027\n## This month's goals\n*   **Make it (part one):** d\n*   **Make it (part two):** d",
      TODAY,
    );
    expect(x.goals.map((g) => g.title)).toEqual(["Make it", "Make it (part two)"]);
    expect(x.notes).toEqual([]);
  });

  it("a bullet without a bold title is reported", () => {
    const x = parseMonthGoals("# Goals for May 2027\n## This month's goals\n*   plain bullet", TODAY);
    expect(x.goals).toEqual([]);
    expect(x.notes).toHaveLength(1);
  });
});

describe("parseHabits", () => {
  const r = parseHabits(habitsMd);

  it("makes daily recurring tasks in mind", () => {
    expect(r.habits.map((h) => h.title)).toEqual([
      "Stretch for five minutes", "Write one line in the diary", "Drink water", "Tidy one corner",
    ]);
    expect(r.habits[0]).toEqual({
      key: "obsidian:task:habits:stretch for five minutes",
      title: "Stretch for five minutes",
      areaId: "mind",
      recur: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    });
  });

  it("reads metrics with commas and percent signs, and weekly lines", () => {
    expect(r.metrics).toEqual([
      { name: "Pretend followers", current: 1200, target: 5000 },
      { name: "Savings jar", current: 40, target: 100 },
    ]);
    expect(r.weekly).toEqual(["3 sessions", "2 posts"]);
    expect(r.notes).toEqual([{ line: "Not a metric line", reason: "not a number out of a number, not shown" }]);
  });

  it("empty, garbage and CRLF", () => {
    expect(parseHabits("")).toEqual({ habits: [], metrics: [], weekly: [], notes: [] });
    expect(() => parseHabits("\u0000 junk ## ## -")).not.toThrow();
    expect(parseHabits(habitsMd.replace(/\n/g, "\r\n"))).toEqual(r);
  });
});

const selectionFrom = () => {
  const a = parseAreaGoals(goalsMd, TODAY).goals;
  const m = parseMonthGoals(monthMd, TODAY);
  const h = parseHabits(habitsMd);
  return { goals: [...a, ...m.goals], tasks: [...m.tasks, ...h.habits] };
};

describe("buildObsidianRows", () => {
  it("builds goals and items, links tasks to goal ids, and fills fields", () => {
    const { goals, items } = buildObsidianRows(selectionFrom(), TODAY);
    expect(goals).toHaveLength(10);
    expect(items).toHaveLength(7);
    const writing = goals.find((g) => g.title === "Writing")!;
    expect(writing).toMatchObject({
      areaId: "writing", kind: "finite", deadline: "2027-12-31", createdAt: TODAY,
      source: { kind: "obsidian", key: "obsidian:goal:writing" },
      cadence: "Weekly: 3 drafting sessions · 1 edit pass",
    });
    expect(writing.milestones.map((m) => m.title)).toEqual(["Publish 2 zines by 30 Jun 2027", "Reach 500 newsletter readers"]);
    expect(writing.milestones.every((m) => m.done === false && m.id.length > 0)).toBe(true);
    expect(new Set(writing.milestones.map((m) => m.id)).size).toBe(2);
    const zine = goals.find((g) => g.title === "Finish the pretend zine")!;
    const step = items.find((i) => i.title === "Write the ending scene")!;
    expect(step).toMatchObject({
      kind: "task", goalId: zine.id, areaId: "admin", priority: 2, status: "open", links: [],
      createdAt: TODAY, touchedAt: TODAY,
      source: { kind: "obsidian", key: "obsidian:task:finish the pretend zine:write the ending scene" },
    });
    expect(step.due).toBeUndefined();
    const habit = items.find((i) => i.title === "Drink water")!;
    expect(habit.recur).toHaveLength(7);
    expect(habit.goalId).toBeUndefined();
    expect(goals.find((g) => g.title === "Art")!.deadline).toBeUndefined();
    expect(new Set([...goals, ...items].map((r) => r.id)).size).toBe(17);
  });

  const base = (): ProposedGoal => ({
    key: "obsidian:goal:x", title: "X", areaId: "art", areaFallback: false, kind: "practice", milestones: [],
  });

  it("rejects a finite goal without a deadline", () => {
    const bad: ProposedGoal = { ...base(), key: "obsidian:goal:bad", kind: "finite" };
    expect(() => buildObsidianRows({ goals: [base(), bad], tasks: [] }, TODAY)).toThrow(/deadline/i);
  });

  it("rejects an invalid deadline, an inbox goal, an unknown area and an inbox task", () => {
    for (const goal of [
      { ...base(), kind: "finite" as const, deadline: "2026-02-30" },
      { ...base(), areaId: "inbox" as const },
      { ...base(), areaId: "nowhere" as never },
    ]) {
      expect(() => buildObsidianRows({ goals: [goal], tasks: [] }, TODAY)).toThrow();
    }
    expect(() =>
      buildObsidianRows({ goals: [], tasks: [{ key: "obsidian:task:x:y", title: "Y", areaId: "inbox" }] }, TODAY),
    ).toThrow();
  });

  it("an empty selection builds nothing", () => {
    expect(buildObsidianRows({ goals: [], tasks: [] }, TODAY)).toEqual({ goals: [], items: [] });
  });
});

