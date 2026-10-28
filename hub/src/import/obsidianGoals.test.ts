import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../data/db";
import { endOfMonth } from "../domain/dates";
import {
  importObsidianGoals,
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

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

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

describe("importObsidianGoals", () => {
  it("adds goals and tasks, links tasks to goal ids, and fills fields", async () => {
    const r = await importObsidianGoals(selectionFrom(), TODAY);
    expect(r).toEqual({ goalsAdded: 10, tasksAdded: 7, alreadyHad: 0 });
    const writing = (await db.goals.filter((g) => g.title === "Writing").first())!;
    expect(writing).toMatchObject({
      areaId: "writing", kind: "finite", deadline: "2027-12-31", createdAt: TODAY,
      source: { kind: "obsidian", key: "obsidian:goal:writing" },
      cadence: "Weekly: 3 drafting sessions · 1 edit pass",
    });
    expect(writing.milestones.map((m) => m.title)).toEqual(["Publish 2 zines by 30 Jun 2027", "Reach 500 newsletter readers"]);
    expect(writing.milestones.every((m) => m.done === false && m.id.length > 0)).toBe(true);
    expect(new Set(writing.milestones.map((m) => m.id)).size).toBe(2);
    const zine = (await db.goals.filter((g) => g.title === "Finish the pretend zine").first())!;
    const step = (await db.items.filter((i) => i.title === "Write the ending scene").first())!;
    expect(step).toMatchObject({
      kind: "task", goalId: zine.id, areaId: "admin", priority: 2, status: "open", links: [],
      createdAt: TODAY, touchedAt: TODAY,
      source: { kind: "obsidian", key: "obsidian:task:finish the pretend zine:write the ending scene" },
    });
    expect(step.due).toBeUndefined();
    const habit = (await db.items.filter((i) => i.title === "Drink water").first())!;
    expect(habit.recur).toHaveLength(7);
    expect(habit.goalId).toBeUndefined();
    const practice = (await db.goals.filter((g) => g.title === "Art").first())!;
    expect(practice.deadline).toBeUndefined();
  });

  it("is idempotent and never changes existing rows, archived or not", async () => {
    await importObsidianGoals(selectionFrom(), TODAY);
    const g = (await db.goals.filter((x) => x.title === "Art").first())!;
    await db.goals.update(g.id, { title: "Art (renamed by me)", areaId: "body" });
    const t = (await db.items.filter((i) => i.title === "Drink water").first())!;
    await db.items.update(t.id, { status: "archived", title: "Drink more water" });
    const goalsBefore = await db.goals.orderBy("id").toArray();
    const itemsBefore = await db.items.orderBy("id").toArray();
    const r = await importObsidianGoals(selectionFrom(), "2027-01-05");
    expect(r).toEqual({ goalsAdded: 0, tasksAdded: 0, alreadyHad: 17 });
    expect(await db.goals.orderBy("id").toArray()).toEqual(goalsBefore);
    expect(await db.items.orderBy("id").toArray()).toEqual(itemsBefore);
  });

  it("links a new task to an existing goal without touching that goal", async () => {
    const sel = selectionFrom();
    await importObsidianGoals({ goals: sel.goals, tasks: [] }, TODAY);
    const before = await db.goals.orderBy("id").toArray();
    const r = await importObsidianGoals(sel, TODAY);
    expect(r.tasksAdded).toBe(7);
    expect(await db.goals.orderBy("id").toArray()).toEqual(before);
    const zine = before.find((g) => g.title === "Finish the pretend zine")!;
    expect((await db.items.filter((i) => i.title === "Write the ending scene").first())!.goalId).toBe(zine.id);
  });

  it("uses one transaction", async () => {
    const spy = vi.spyOn(db, "transaction");
    await importObsidianGoals(selectionFrom(), TODAY);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  const base = (): ProposedGoal => ({
    key: "obsidian:goal:x", title: "X", areaId: "art", areaFallback: false, kind: "practice", milestones: [],
  });

  it("rejects a finite goal without a deadline, writing nothing", async () => {
    const bad: ProposedGoal = { ...base(), key: "obsidian:goal:bad", kind: "finite" };
    await expect(importObsidianGoals({ goals: [base(), bad], tasks: [] }, TODAY)).rejects.toThrow(/deadline/i);
    expect(await db.goals.count()).toBe(0);
  });

  it("rejects an invalid deadline, an inbox goal, an unknown area and an inbox task, writing nothing", async () => {
    for (const goal of [
      { ...base(), kind: "finite" as const, deadline: "2026-02-30" },
      { ...base(), areaId: "inbox" as const },
      { ...base(), areaId: "nowhere" as never },
    ]) {
      await expect(importObsidianGoals({ goals: [goal], tasks: [] }, TODAY)).rejects.toThrow();
    }
    await expect(
      importObsidianGoals({ goals: [], tasks: [{ key: "obsidian:task:x:y", title: "Y", areaId: "inbox" }] }, TODAY),
    ).rejects.toThrow();
    expect(await db.goals.count()).toBe(0);
    expect(await db.items.count()).toBe(0);
  });

  it("an empty selection adds nothing", async () => {
    expect(await importObsidianGoals({ goals: [], tasks: [] }, TODAY)).toEqual({ goalsAdded: 0, tasksAdded: 0, alreadyHad: 0 });
  });
});
