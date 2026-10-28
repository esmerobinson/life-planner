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

  it("each bold label is an area; the goal is titled with the month and keeps the label", () => {
    expect(r.monthEnd).toBe("2028-02-29");
    expect(r.goals.map((g) => g.title)).toEqual([
      "February goal: Writing (Pretend Zine)",
      "February goal: Creative Technologist",
      "February goal: Gardening Corner",
    ]);
    expect(r.goals[0]).toMatchObject({
      kind: "finite", areaId: "writing", areaFallback: false, deadline: "2028-02-29", milestones: [],
      key: "obsidian:month:february goal: writing (pretend zine)",
    });
    expect(r.goals[1]).toMatchObject({ areaId: "tech", areaFallback: false });
    // an area name that maps to nothing falls back to admin, never the inbox
    expect(r.goals[2]).toMatchObject({ areaId: "admin", areaFallback: true });
    expect(r.notes).toEqual([]);
  });

  it("the description and the nested line become the notes, with a Done when line", () => {
    expect(r.goals[0].notes).toBe(
      "Get the whole first draft down, rough is fine.\nDone when: Chapter three is finished and sent to a friend",
    );
    expect(r.goals[1].notes).toBe("Build the small invented tool.\nDone when: It runs on my own machine");
  });

  it("makes no tasks from the nested lines", () => {
    expect("tasks" in r).toBe(false);
  });

  it("ignores the other sections", () => {
    expect(r.goals.map((g) => g.title).join("|")).not.toContain("Not a goal");
  });

  it.each([
    ["Writing (Relationship Book)", "writing"],
    ["Creative Technologist", "tech"],
    ["Inner Work", "mind"],
    ["Production", "production"],
    ["Health", "body"],
  ])("label %s maps to %s", (label, area) => {
    const x = parseMonthGoals(`# Goals for October 2026\n## This month's goals\n*   **${label}:** d`, TODAY);
    expect(x.goals[0]).toMatchObject({ areaId: area, title: `October goal: ${label}` });
  });

  it("a goal without a nested line has only its description as notes", () => {
    const x = parseMonthGoals("# Goals for March 2027\n## This month's goals\n*   **Art:** desc only", TODAY);
    expect(x.goals[0].notes).toBe("desc only");
    expect(x.monthEnd).toBe("2027-03-31");
  });

  it("a goal with a nested line but no description still gets Done when", () => {
    const x = parseMonthGoals("# Goals for March 2027\n## This month's goals\n*   **Art:**\n    *   Test-sign: It exists", TODAY);
    expect(x.goals[0].notes).toBe("Done when: It exists");
  });

  it("only the first nested line counts, and no 'next step' note is made", () => {
    const x = parseMonthGoals(
      "# Goals for May 2027\n## This month's goals\n*   **Art:** d\n    *   Try-first: One\n    *   Other-bit: Two",
      TODAY,
    );
    expect(x.goals[0].notes).toBe("d\nDone when: One");
    expect(x.notes).toEqual([]);
  });

  it("without a readable month heading, uses this month's name and end, and says so", () => {
    const x = parseMonthGoals("## This month's goals\n*   **Art:** desc", TODAY);
    expect(x.monthEnd).toBeUndefined();
    expect(x.goals[0].deadline).toBe("2026-10-31");
    expect(x.goals[0].title).toBe("October goal: Art");
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

  it("the same label twice is reported once, not duplicated", () => {
    const x = parseMonthGoals("# Goals for May 2027\n## This month's goals\n*   **Art:** a\n*   **Art:** b", TODAY);
    expect(x.goals).toHaveLength(1);
    expect(x.notes).toHaveLength(1);
  });

  it("a bullet without a bold title is reported", () => {
    const x = parseMonthGoals("# Goals for May 2027\n## This month's goals\n*   plain bullet", TODAY);
    expect(x.goals).toEqual([]);
    expect(x.notes).toHaveLength(1);
  });
});

describe("key spaces and length limits", () => {
  it("a monthly goal and an area goal with the same title do not share a key", () => {
    const a = parseAreaGoals("## Writing\n- Identity: x", TODAY).goals[0];
    const m = parseMonthGoals("# Goals for May 2027\n## This month's goals\n*   **Writing:** d\n    *   Done-test: Draft", TODAY);
    expect(a.key).toBe("obsidian:goal:writing");
    expect(m.goals[0].key).toBe("obsidian:month:may goal: writing");
    const rows = buildObsidianRows({ goals: [a, ...m.goals], tasks: [] }, TODAY);
    expect(rows.goals).toHaveLength(2);
  });

  it("cuts why, cadence and notes at 4000 characters and says which area", () => {
    const long = "x".repeat(5000);
    const r = parseAreaGoals(`## Writing\n- Identity: ${long}\n- Weekly: ${long}\n- Study these north stars: ${long}`, TODAY);
    expect(r.goals[0].why).toHaveLength(4000);
    expect(r.goals[0].cadence).toHaveLength(4000);
    expect(r.goals[0].notes).toHaveLength(4000);
    expect(r.notes).toHaveLength(3);
    expect(r.notes.every((n) => n.line === "Writing" && /4000/.test(n.reason))).toBe(true);
  });

  it("cuts a monthly goal's description at 4000 characters and says which goal", () => {
    const r = parseMonthGoals(`# Goals for May 2027\n## This month's goals\n*   **Big one:** ${"y".repeat(5000)}`, TODAY);
    expect(r.goals[0].notes).toHaveLength(4000);
    expect(r.notes).toEqual([{ line: "May goal: Big one", reason: "notes cut to 4000 characters" }]);
  });
});

describe("parseHabits", () => {
  const r = parseHabits(habitsMd);

  it("makes daily recurring tasks; movement habits go to body, the rest to mind", () => {
    expect(r.habits.map((h) => h.title)).toEqual([
      "Stretch for five minutes", "Write one line in the diary", "Drink water", "Tidy one corner",
    ]);
    expect(r.habits[0]).toEqual({
      key: "obsidian:task:habits:stretch for five minutes",
      title: "Stretch for five minutes",
      areaId: "body",
      recur: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    });
    expect(r.habits.slice(1).map((h) => h.areaId)).toEqual(["mind", "mind", "mind"]);
  });

  it.each([
    ["Go for a walk", "body"],
    ["Morning run", "body"],
    ["Movement break", "body"],
    ["Do some exercise", "body"],
    ["Workout at home", "body"],
    ["Calisthenics set", "body"],
    ["Yoga flow", "body"],
    ["Quick GYM visit", "body"],
    ["Stretching", "body"],
    ["Meditate", "mind"],
    ["Read a chapter", "mind"],
    ["Runway planning notes", "mind"],
    ["Prune the shrubs", "mind"],
  ])("habit %s goes to %s", (text, area) => {
    expect(parseHabits(`## Daily habits\n- ${text}`).habits[0].areaId).toBe(area);
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
  return { goals: [...a, ...m.goals], tasks: h.habits };
};

describe("buildObsidianRows", () => {
  it("builds goals and items, links tasks to goal ids, and fills fields", () => {
    const { goals, items } = buildObsidianRows(selectionFrom(), TODAY);
    expect(goals).toHaveLength(10);
    expect(items).toHaveLength(4);
    const writing = goals.find((g) => g.title === "Writing")!;
    expect(writing).toMatchObject({
      areaId: "writing", kind: "finite", deadline: "2027-12-31", createdAt: TODAY,
      source: { kind: "obsidian", key: "obsidian:goal:writing" },
      cadence: "Weekly: 3 drafting sessions · 1 edit pass",
    });
    expect(writing.milestones.map((m) => m.title)).toEqual(["Publish 2 zines by 30 Jun 2027", "Reach 500 newsletter readers"]);
    expect(writing.milestones.every((m) => m.done === false && m.id.length > 0)).toBe(true);
    expect(new Set(writing.milestones.map((m) => m.id)).size).toBe(2);
    const month = goals.find((g) => g.title === "February goal: Writing (Pretend Zine)")!;
    expect(month).toMatchObject({ areaId: "writing", kind: "finite", deadline: "2028-02-29" });
    // a task given a goalKey is linked to that goal's new id
    const linked = buildObsidianRows(
      { goals: selectionFrom().goals, tasks: [{ key: "obsidian:task:x:y", title: "Linked", areaId: "art", goalKey: month.source!.key }] },
      TODAY,
    );
    const step = linked.items[0];
    expect(step).toMatchObject({
      kind: "task", goalId: linked.goals.find((g) => g.source?.key === month.source!.key)!.id, areaId: "art",
      priority: 2, status: "open", links: [], createdAt: TODAY, touchedAt: TODAY,
      source: { kind: "obsidian", key: "obsidian:task:x:y" },
    });
    expect(step.due).toBeUndefined();
    const habit = items.find((i) => i.title === "Drink water")!;
    expect(habit.recur).toHaveLength(7);
    expect(habit.goalId).toBeUndefined();
    expect(goals.find((g) => g.title === "Art")!.deadline).toBeUndefined();
    expect(new Set([...goals, ...items].map((r) => r.id)).size).toBe(14);
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

