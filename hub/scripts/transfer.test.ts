import { beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "../src/data/db";
import { parseBackup, restoreBackup } from "../src/data/backup";
import { unstamped } from "../src/test/unstamped";
import { buildTransfer, formatFailure, runTransfer, type TransferInputs } from "./transfer";

const FIX = join(process.cwd(), "src/import/__fixtures__");
const read = (f: string) => readFileSync(join(FIX, f), "utf8");
const TODAY = "2026-10-28";

const GTASKS = JSON.stringify({
  lists: [
    {
      id: "L1",
      title: "Errand Pile",
      tasks: [
        { id: "a1", title: "Water the fictional FERNS!", status: "needsAction", notes: "same as backlog", due: "2026-11-02T00:00:00.000Z" },
        { id: "a2", title: "Post the invented parcel", status: "needsAction" },
        { id: "a3", title: "Buy pretend stamps", status: "needsAction", notes: "x".repeat(300) },
        { id: "a4", title: "post the invented parcel", status: "needsAction" },
      ],
    },
  ],
});

const inputs = (): TransferInputs => ({
  backlog: read("Backlog.md"),
  goals: read("ObsidianGoals.md"),
  month: read("ObsidianMonth.md"),
  habits: read("ObsidianHabits.md"),
  gtasks: GTASKS,
  missing: [],
});

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

describe("buildTransfer", () => {
  it("builds a backup that the app's own validator accepts", () => {
    const t = buildTransfer(inputs(), TODAY);
    expect(() => parseBackup(JSON.parse(JSON.stringify(t.backup)))).not.toThrow();
    expect(t.backup).toMatchObject({ app: "life-hub", schema: 1, exportedOn: TODAY });
    expect(t.backup.items.every((i) => i.createdAt === TODAY && i.touchedAt === TODAY)).toBe(true);
    expect(new Set([...t.backup.items, ...t.backup.goals].map((r) => r.id)).size).toBe(
      t.backup.items.length + t.backup.goals.length,
    );
  });

  it("restoring it into an empty database gives the expected counts", async () => {
    const t = buildTransfer(inputs(), TODAY);
    const r = await restoreBackup(JSON.parse(JSON.stringify(t.backup)), "merge");
    expect(r).toEqual({ addedItems: t.backup.items.length, addedGoals: t.backup.goals.length, skipped: 0 });
    // the rows in the database are exactly the rows in the file, not just the same number of them
    const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId((await db.items.toArray()).map(unstamped))).toEqual(byId(t.backup.items));
    expect(byId((await db.goals.toArray()).map(unstamped))).toEqual(byId(t.backup.goals));
    expect(t.counts.goals).toBe(10);
    expect("nextSteps" in t.counts).toBe(false);
    expect(t.counts.habits).toBe(4);
    expect(t.counts.backlogItems).toBe(12);
    expect(t.counts.gtasksAdded).toBe(2);
    expect(t.counts.gtasksDuplicates).toBe(2);
    expect(t.backup.items).toHaveLength(12 + 2 + 4);
  });

  it("goals carry milestones, why and cadence; monthly goals are area goals with Done when; habits repeat daily", () => {
    const { backup } = buildTransfer(inputs(), TODAY);
    const writing = backup.goals.find((g) => g.title === "Writing")!;
    expect(writing.milestones).toHaveLength(2);
    expect(writing.why).toContain("small pretend zines");
    expect(writing.cadence).toContain("Weekly:");
    expect(backup.goals.every((g) => g.areaId !== "inbox")).toBe(true);
    const zine = backup.goals.find((g) => g.title === "February goal: Writing (Pretend Zine)")!;
    expect(zine).toMatchObject({ areaId: "writing", kind: "finite", deadline: "2028-02-29" });
    expect(zine.notes).toContain("Done when: Chapter three is finished");
    expect(backup.goals.find((g) => g.title === "February goal: Creative Technologist")!.areaId).toBe("tech");
    // the nested lines are success criteria, not tasks
    expect(backup.items.some((i) => i.source?.key.startsWith("obsidian:month-task"))).toBe(false);
    expect(backup.items.some((i) => /chapter three|runs on my own machine/i.test(i.title))).toBe(false);
    expect(backup.items.find((i) => i.title === "Stretch for five minutes")!.areaId).toBe("body");
    const habit = backup.items.find((i) => i.title === "Drink water")!;
    expect(habit.recur).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
    expect(backup.goals.find((g) => g.title === "Gardening corner")!.areaId).toBe("admin");
  });

  it("backlog rows use the same keys and areas as importBacklog", () => {
    const { backup } = buildTransfer(inputs(), TODAY);
    const lh = backup.items.find((i) => i.title === "Outline the invented lighthouse story")!;
    expect(lh).toMatchObject({ areaId: "writing", source: { kind: "backlog", key: "backlog:outline the invented lighthouse story" } });
  });

  it("skips google tasks with the same title as a transferred item and lists them in the summary", () => {
    const t = buildTransfer(inputs(), TODAY);
    const titles = t.backup.items.map((i) => i.title);
    expect(titles).not.toContain("Water the fictional FERNS!");
    expect(titles.filter((x) => /invented parcel/i.test(x))).toHaveLength(1);
    expect(t.summary).toContain("Water the fictional FERNS!");
    expect(t.summary).toContain("Errand Pile");
    expect(t.summary).toMatch(/had notes/);
    expect(t.summary).toMatch(/had a due date/);
  });

  it("the summary has the readable sections and the load instructions", () => {
    const { summary } = buildTransfer(inputs(), TODAY);
    for (const h of [
      "Items by area", "Goals", "Monthly goals", "Daily habits",
      "Google Tasks skipped as the same title", "Notes", "How to load this", "Still in your Inbox",
    ]) {
      expect(summary).toContain(h);
    }
    expect(summary).toMatch(/February goal: Writing \(Pretend Zine\).*Writing.*2028-02-29/);
    expect(summary).toContain("Done when: Chapter three is finished and sent to a friend");
    expect(summary).not.toContain("next steps");
    expect(summary).toContain("Merge");
  });

  it("a missing input is skipped with a note", () => {
    const t = buildTransfer({ backlog: read("Backlog.md"), missing: ["Goals.md"] }, TODAY);
    expect(t.backup.goals).toEqual([]);
    expect(t.notes.some((n) => n.reason.includes("Goals.md") && /skipped/.test(n.reason))).toBe(true);
    expect(t.summary).toContain("Goals.md");
  });

  it("refuses a result that does not validate", () => {
    expect(() => buildTransfer(inputs(), "2026-13-45")).toThrow(/does not validate.*Nothing was written/i);
  });

  it("an oversized goal field is cut with a note instead of failing the whole transfer", () => {
    const huge = "## Writing\n- Identity: " + "x".repeat(5000);
    const t = buildTransfer({ goals: huge, missing: [] }, TODAY);
    expect(t.backup.goals[0].why).toHaveLength(4000);
    expect(t.notes.some((n) => /4000/.test(n.reason) && n.line === "Writing")).toBe(true);
  });
});

describe("classification hook", () => {
  const inboxCount = (t: ReturnType<typeof buildTransfer>) => t.backup.items.filter((i) => i.areaId === "inbox").length;

  it("lists every item that would land in the inbox, with stable keys across runs", () => {
    const a = buildTransfer(inputs(), TODAY);
    const b = buildTransfer(inputs(), TODAY);
    expect(a.classify.length).toBe(inboxCount(a));
    expect(a.classify.map((c) => c.key).sort()).toEqual(b.classify.map((c) => c.key).sort());
    const ferns = a.classify.find((c) => c.title === "Water the fictional ferns")!;
    expect(ferns).toMatchObject({ key: "backlog:water the fictional ferns", origin: "backlog", section: "Active" });
    const parcel = a.classify.find((c) => c.title === "Post the invented parcel")!;
    expect(parcel).toMatchObject({ key: "gtasks:a2", origin: "gtasks", list: "Errand Pile" });
    const stamps = a.classify.find((c) => c.title === "Buy pretend stamps")!;
    expect(stamps.notes).toHaveLength(200);
    expect(a.classify.some((c) => c.title === "Outline the invented lighthouse story")).toBe(false);
  });

  it("applies an areas map to inbox items only and reports the rest", () => {
    const t = buildTransfer(inputs(), TODAY, {
      areas: {
        "gtasks:a2": "admin",
        "backlog:water the fictional ferns": "body",
        "backlog:outline the invented lighthouse story": "art", // already sorted by rules: not an inbox item
        "gtasks:a3": "inbox", // invalid target
        "gtasks:a3x": "art", // unknown key
        "backlog:sketch a lighthouse": "nowhere", // invalid area
      },
    });
    const by = (title: string) => t.backup.items.find((i) => i.title === title)!;
    expect(by("Post the invented parcel").areaId).toBe("admin");
    expect(by("Water the fictional ferns").areaId).toBe("body");
    expect(by("Outline the invented lighthouse story").areaId).toBe("writing");
    expect(by("Buy pretend stamps").areaId).toBe("inbox");
    expect(by("Sketch a lighthouse").areaId).toBe("inbox");
    expect(t.counts.sorted).toBe(2);
    expect(t.counts.stillInInbox).toBe(inboxCount(t));
    const reasons = t.notes.map((n) => n.reason).join("\n");
    expect(reasons).toMatch(/inbox.*ignored|ignored.*inbox/i);
    expect(reasons).toMatch(/not a known area/i);
    expect(reasons).toMatch(/no inbox item/i);
    expect(t.summary).toContain("Sorted for you");
    expect(t.summary).toContain("Post the invented parcel -> Admin");
    expect(t.summary).toContain("Water the fictional ferns -> Body");
    expect(t.summary).not.toContain("Outline the invented lighthouse story -> Art");
    expect(t.classify.length).toBe(inboxCount(buildTransfer(inputs(), TODAY)));
    expect(() => parseBackup(JSON.parse(JSON.stringify(t.backup)))).not.toThrow();
  });

  it("the same keys sort the same items on a second run", () => {
    const areas = { "gtasks:a2": "admin" };
    const a = buildTransfer(inputs(), TODAY, { areas });
    const b = buildTransfer(inputs(), TODAY, { areas });
    expect(b.backup.items.find((i) => i.title === "Post the invented parcel")!.areaId).toBe("admin");
    expect(b.backup).toEqual(a.backup);
  });
});

describe("failure messages", () => {
  it("always end with Nothing was written., once", () => {
    expect(formatFailure(new Error("The areas file could not be read."))).toBe(
      "The areas file could not be read. Nothing was written.",
    );
    expect(formatFailure(new Error("Already says it. Nothing was written."))).toBe("Already says it. Nothing was written.");
    expect(formatFailure("weird")).toBe("The transfer did not work. Nothing was written.");
  });
});

describe("deterministic ids", () => {
  it("the same input gives the same ids, goal links and milestone ids", () => {
    const a = buildTransfer(inputs(), TODAY);
    const b = buildTransfer(inputs(), TODAY);
    expect(b.backup).toEqual(a.backup);
    const writing = a.backup.goals.find((g) => g.title === "Writing")!;
    expect(writing.milestones).toHaveLength(2);
    expect(writing.milestones[0].id).not.toBe(writing.milestones[1].id);
    expect(a.backup.goals.every((g) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(g.id))).toBe(true);
  });

  it("every goalId points at a goal in the file", () => {
    const { backup } = buildTransfer(inputs(), TODAY);
    const goalIds = new Set(backup.goals.map((g) => g.id));
    const linked = backup.items.filter((i) => i.goalId);
    expect(linked.every((i) => goalIds.has(i.goalId!))).toBe(true);
  });

  it("loading a second run with Merge adds nothing", async () => {
    const first = buildTransfer(inputs(), TODAY);
    await restoreBackup(JSON.parse(JSON.stringify(first.backup)), "merge");
    const second = buildTransfer(inputs(), TODAY);
    const r = await restoreBackup(JSON.parse(JSON.stringify(second.backup)), "merge");
    expect(r).toMatchObject({ addedItems: 0, addedGoals: 0 });
    expect(await db.items.count()).toBe(first.backup.items.length);
    expect(await db.goals.count()).toBe(first.backup.goals.length);
  });

  it("the summary starts the load steps with downloading a backup first", () => {
    const { summary } = buildTransfer(inputs(), TODAY);
    const steps = summary.slice(summary.indexOf("## How to load this"));
    expect(steps).toMatch(/1\. Download a backup first \(Backup page\)/);
    expect(steps).toMatch(/Merge/);
  });
});

describe("the same task in the Backlog and in Google Tasks", () => {
  const backlog = [
    "## Inbox (to triage)",
    "- [ ] Renew pretend passport (from Google Tasks) (overdue!)",
    "- [ ] Water pretend plants (due today)",
    "## Life admin",
    "- [ ] Water pretend plants",
    "- [ ] Renew pretend passport (due in 2d)",
    "- [ ] Call [[Sam Example|Sam]] about the [[[[Art - Home|Art]] - Home|Art]] session",
  ].join("\n");
  const gtasks = JSON.stringify({
    lists: [
      {
        id: "p",
        title: "Paperwork",
        tasks: [
          { id: "p1", title: "Renew pretend passport", status: "needsAction", notes: "Take photos", due: "2026-12-15T00:00:00.000Z" },
          { id: "p2", title: "Only in google", status: "needsAction" },
        ],
      },
    ],
  });
  const t = () => buildTransfer({ backlog, gtasks, missing: [] }, TODAY);

  it("keeps exactly one item per task, with cleaned titles", () => {
    const titles = t().backup.items.map((i) => i.title).sort();
    expect(titles).toEqual(["Call Sam about the Art session", "Only in google", "Renew pretend passport", "Water pretend plants"]);
  });

  it("keeps the Backlog row's area and adds the Google list tag, notes and due", () => {
    const passport = t().backup.items.find((i) => i.title === "Renew pretend passport")!;
    expect(passport).toMatchObject({
      areaId: "admin", due: "2026-12-15", tags: ["paperwork"], source: { kind: "backlog", key: "backlog:renew pretend passport" },
    });
    expect(passport.notes?.split("\n").sort()).toEqual(["Take photos", "Was overdue on import"]);
  });

  it("does not overwrite a due date the Backlog row already has", () => {
    const b = "## Life admin\n- [ ] Renew pretend passport [due 2026-11-30]";
    const r = buildTransfer({ backlog: b, gtasks, missing: [] }, TODAY);
    expect(r.backup.items.find((i) => i.title === "Renew pretend passport")!.due).toBe("2026-11-30");
  });

  it("lists every merged copy in the summary and counts them", () => {
    const r = t();
    expect(r.counts.backlogMerged).toBe(2);
    expect(r.counts.gtasksDuplicates).toBe(1);
    expect(r.counts.mergedIntoBacklog).toBe(1);
    expect(r.summary).toContain("Backlog copies folded together");
    expect(r.summary).toMatch(/Water pretend plants/);
    expect(r.summary).toMatch(/Renew pretend passport \(from Paperwork\).*merged into the Backlog item/);
  });

  it("a Google task matching a Backlog task never creates a second item (inbox copies too)", () => {
    const b = "## Inbox (to triage)\n- [ ] Order pretend seeds (from Google Tasks)";
    const g = JSON.stringify({ lists: [{ id: "l", title: "Garden", tasks: [{ id: "g1", title: "Order pretend seeds", status: "needsAction" }] }] });
    const r = buildTransfer({ backlog: b, gtasks: g, missing: [] }, TODAY);
    expect(r.backup.items).toHaveLength(1);
    expect(r.backup.items[0]).toMatchObject({ areaId: "inbox", tags: ["garden"] });
  });
});

describe("--extra vault-review items", () => {
  const line = (o: Record<string, unknown>) => JSON.stringify(o);
  const EXTRA = [
    line({ key: "x:daily:1", title: "Pretend idea from daily notes", kind: "idea", areaId: "inbox", tag: "from-daily-notes", notes: "A note" }),
    line({ key: "x:old:1", title: "Pretend old list task", kind: "task", areaId: "art", tag: "from-old-task-lists", due: "2026-12-01", check: "not sure if this is still open" }),
    line({ key: "x:proj:1", title: "Pretend project goal", kind: "goal", areaId: "tech", tag: "from-project-notes", notes: "Goal detail" }),
    line({ key: "x:proj:2", title: "Pretend dated goal", kind: "goal", areaId: "admin", tag: "from-project-notes", due: "2027-03-01" }),
    line({ key: "x:daily:2", title: "Pretend check with notes", kind: "task", areaId: "inbox", tag: "from-daily-notes", notes: "Original text", check: "idea or to-do?" }),
  ].join("\n");

  it("adds ideas, tasks and goals with their tags, and applies the check reason", () => {
    const t = buildTransfer({ ...inputs(), extra: EXTRA }, TODAY);
    const by = (title: string) => t.backup.items.find((i) => i.title === title)!;
    expect(by("Pretend idea from daily notes")).toMatchObject({
      kind: "idea", areaId: "inbox", tags: ["from-daily-notes"], notes: "A note", priority: 2, status: "open",
      createdAt: TODAY, touchedAt: TODAY, source: { kind: "obsidian", key: "x:daily:1" },
    });
    expect(by("Pretend old list task")).toMatchObject({
      kind: "task", areaId: "art", due: "2026-12-01", tags: ["from-old-task-lists", "check"],
      notes: "Check: not sure if this is still open",
    });
    expect(by("Pretend check with notes").notes).toBe("Check: idea or to-do?\nOriginal text");
    const g = t.backup.goals.find((x) => x.title === "Pretend project goal")!;
    expect(g).toMatchObject({ kind: "practice", areaId: "tech", notes: "Goal detail", source: { kind: "obsidian", key: "x:proj:1" } });
    expect(g.deadline).toBeUndefined();
    expect(t.backup.goals.find((x) => x.title === "Pretend dated goal")).toMatchObject({ kind: "practice", deadline: "2027-03-01" });
    expect(t.counts.extraItems).toBe(3);
    expect(t.counts.extraGoals).toBe(2);
    expect(() => parseBackup(JSON.parse(JSON.stringify(t.backup)))).not.toThrow();
  });

  it("validates each line and reports the bad ones without stopping", () => {
    const bad = [
      "not json",
      line({ key: "b1", title: "No tag", kind: "task", areaId: "art", tag: "from-nowhere" }),
      line({ key: "b2", title: "Bad kind", kind: "epic", areaId: "art", tag: "from-daily-notes" }),
      line({ key: "b3", title: "Goal in inbox", kind: "goal", areaId: "inbox", tag: "from-project-notes" }),
      line({ key: "b4", title: "Bad area", kind: "task", areaId: "nowhere", tag: "from-daily-notes" }),
      line({ key: "b5", title: "   ", kind: "task", areaId: "art", tag: "from-daily-notes" }),
      line({ key: "b6", title: "Bad due", kind: "task", areaId: "art", tag: "from-daily-notes", due: "2026-02-30" }),
      line({ key: "", title: "No key", kind: "task", areaId: "art", tag: "from-daily-notes" }),
      line({ key: "ok1", title: "Fine one", kind: "task", areaId: "art", tag: "from-daily-notes" }),
      line({ key: "ok1", title: "Same key again", kind: "task", areaId: "art", tag: "from-daily-notes" }),
      "",
    ].join("\n");
    const t = buildTransfer({ ...inputs(), extra: bad }, TODAY);
    expect(t.counts.extraItems).toBe(1);
    expect(t.backup.items.some((i) => i.title === "Fine one")).toBe(true);
    expect(t.backup.items.some((i) => i.title === "Same key again")).toBe(false);
    expect(t.notes.filter((n) => /extra/i.test(n.reason)).length).toBe(9);
    expect(t.summary).toMatch(/extra line 1/i);
    expect(() => parseBackup(JSON.parse(JSON.stringify(t.backup)))).not.toThrow();
  });

  it("extra items in the inbox are not in the classify list, but an areas file can sort them", () => {
    const a = buildTransfer({ ...inputs(), extra: EXTRA }, TODAY);
    expect(a.classify.some((c) => c.key.startsWith("x:"))).toBe(false);
    const b = buildTransfer({ ...inputs(), extra: EXTRA }, TODAY, { areas: { "x:daily:1": "mind" } });
    expect(b.backup.items.find((i) => i.title === "Pretend idea from daily notes")!.areaId).toBe("mind");
  });

  it("cuts oversized goal notes with a note naming the line, and ideas never keep a due date", () => {
    const big = line({ key: "g1", title: "Big goal", kind: "goal", areaId: "art", tag: "from-project-notes", notes: "z".repeat(5000) });
    const idea = line({ key: "i1", title: "Dated idea", kind: "idea", areaId: "inbox", tag: "from-daily-notes", due: "2026-12-01" });
    const t = buildTransfer({ ...inputs(), extra: `${big}\n${idea}` }, TODAY);
    expect(t.backup.goals.find((g) => g.title === "Big goal")!.notes).toHaveLength(4000);
    expect(t.notes.some((n) => /extra line 1/.test(n.reason) && /4000/.test(n.reason))).toBe(true);
    const i = t.backup.items.find((x) => x.title === "Dated idea")!;
    expect("due" in i).toBe(false);
    expect(t.notes.some((n) => /extra line 2/.test(n.reason) && /idea/.test(n.reason))).toBe(true);
    expect(() => parseBackup(JSON.parse(JSON.stringify(t.backup)))).not.toThrow();
  });

  it("a key that collides with a transferred row is reported, not duplicated", () => {
    const t = buildTransfer(
      { ...inputs(), extra: line({ key: "backlog:water the fictional ferns", title: "Dupe", kind: "task", areaId: "art", tag: "from-daily-notes" }) },
      TODAY,
    );
    expect(t.backup.items.some((i) => i.title === "Dupe")).toBe(false);
    expect(t.notes.some((n) => /extra/i.test(n.reason) && /key/i.test(n.reason))).toBe(true);
  });
});

describe("runTransfer", () => {
  let dir: string;
  let vault: string;
  let out: string;
  let gt: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "transfer-test-"));
    vault = join(dir, "vault");
    out = join(dir, "out");
    mkdirSync(vault);
    mkdirSync(out);
    writeFileSync(join(vault, "Backlog.md"), read("Backlog.md"));
    writeFileSync(join(vault, "Goals.md"), read("ObsidianGoals.md"));
    writeFileSync(join(vault, "Goals for month.md"), read("ObsidianMonth.md"));
    writeFileSync(join(vault, "Goals & Habits.md"), read("ObsidianHabits.md"));
    gt = join(dir, "gtasks.json");
    writeFileSync(gt, GTASKS);
  });

  const run = (extra: Partial<Parameters<typeof runTransfer>[0]> = {}) =>
    runTransfer({ vault, gtasks: gt, out, today: TODAY, ...extra });

  it("writes the backup and summary with mode 0600, valid for restore", () => {
    const r = run();
    const backupPath = join(out, `esmeworld-transfer-${TODAY}.json`);
    const summaryPath = join(out, `esmeworld-transfer-${TODAY}-summary.md`);
    for (const p of [backupPath, summaryPath]) {
      expect(existsSync(p)).toBe(true);
      expect(statSync(p).mode & 0o777).toBe(0o600);
    }
    expect(() => parseBackup(readFileSync(backupPath, "utf8"))).not.toThrow();
    expect(readFileSync(summaryPath, "utf8")).toContain("How to load this");
    expect(r.lines.join("\n")).toContain(backupPath);
  });

  it("terminal output is counts only: no fixture titles or text", () => {
    const text = run().lines.join("\n");
    for (const secret of [
      "ferns", "lighthouse", "zine", "parcel", "Gardening", "Drink water", "Errand Pile", "landlord", "pretend",
    ]) {
      expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    expect(text).toMatch(/\d+/);
  });

  it("does not change the vault or the google file", () => {
    const before = [join(vault, "Backlog.md"), join(vault, "Goals.md"), gt].map((p) => [readFileSync(p, "utf8"), statSync(p).mtimeMs]);
    run();
    const after = [join(vault, "Backlog.md"), join(vault, "Goals.md"), gt].map((p) => [readFileSync(p, "utf8"), statSync(p).mtimeMs]);
    expect(after).toEqual(before);
  });

  it("skips a missing vault file or google file with a note, and still writes", () => {
    const r = runTransfer({ vault, gtasks: join(dir, "nope.json"), out, today: TODAY });
    expect(readFileSync(join(out, `esmeworld-transfer-${TODAY}-summary.md`), "utf8")).toContain("nope.json");
    const r2 = runTransfer({ vault: join(dir, "no-vault"), gtasks: gt, out, today: "2026-10-29" });
    const s = readFileSync(join(out, "esmeworld-transfer-2026-10-29-summary.md"), "utf8");
    expect(s).toContain("Backlog.md");
    expect(r.lines.join("\n")).toMatch(/notes/i);
    expect(r2.lines.join("\n")).toMatch(/notes/i);
  });

  it("writes the classify file privately and applies an areas file", () => {
    const classifyOut = join(out, "classify.json");
    run({ classifyOut });
    expect(statSync(classifyOut).mode & 0o777).toBe(0o600);
    const list = JSON.parse(readFileSync(classifyOut, "utf8")) as { key: string; title: string; origin: string }[];
    expect(list.find((c) => c.key === "gtasks:a2")).toMatchObject({ title: "Post the invented parcel", origin: "gtasks" });

    const areasFile = join(dir, "areas.json");
    writeFileSync(areasFile, JSON.stringify({ "gtasks:a2": "admin" }));
    chmodSync(areasFile, 0o600);
    const r = run({ areasFile });
    const backup = parseBackup(readFileSync(join(out, `esmeworld-transfer-${TODAY}.json`), "utf8"));
    expect(backup.items.find((i) => i.title === "Post the invented parcel")!.areaId).toBe("admin");
    expect(r.lines.join("\n")).toMatch(/sorted/i);
    expect(r.lines.join("\n")).not.toMatch(/parcel/i);
  });

  it("leaves only the finished files in the output folder (no temp files)", () => {
    run({ classifyOut: join(out, "classify.json") });
    expect(readdirSync(out).sort()).toEqual([
      "classify.json",
      `esmeworld-transfer-${TODAY}-summary.md`,
      `esmeworld-transfer-${TODAY}.json`,
    ]);
  });

  describe("output paths are guarded", () => {
    const untouched = (p: string) => expect(existsSync(p)).toBe(false);

    it("refuses an output folder inside the vault or equal to it", () => {
      const inside = join(vault, "exports");
      expect(() => run({ out: inside })).toThrow(/Nothing was written/);
      untouched(inside);
      expect(() => run({ out: vault })).toThrow(/inside your notes|vault/i);
      expect(readdirSync(vault).some((f) => f.startsWith("esmeworld-transfer"))).toBe(false);
    });

    it("refuses an output folder inside a protected folder, including through a symlink", () => {
      const prot = join(dir, "protected");
      mkdirSync(prot);
      expect(() => run({ protectedDirs: [prot], out: join(prot, "o") })).toThrow(/Nothing was written/);
      untouched(join(prot, "o"));
      symlinkSync(prot, join(dir, "link"));
      expect(() => run({ protectedDirs: [prot], out: join(dir, "link", "o") })).toThrow(/Nothing was written/);
      untouched(join(prot, "o"));
    });

    it("refuses an output folder inside the git repository", () => {
      const inRepo = join(process.cwd(), "tmp-transfer-test-out");
      expect(() => run({ out: inRepo })).toThrow(/Nothing was written/);
      untouched(inRepo);
    });

    it("refuses to overwrite an input file", () => {
      const backupPath = join(out, `esmeworld-transfer-${TODAY}.json`);
      writeFileSync(backupPath, "keep me");
      const areasFile = join(dir, "areas.json");
      writeFileSync(areasFile, "{}");
      expect(() => run({ extraFile: backupPath })).toThrow(/overwrite|input/i);
      expect(() => run({ classifyOut: areasFile, areasFile })).toThrow(/overwrite|input/i);
      const summaryPath = join(out, `esmeworld-transfer-${TODAY}-summary.md`);
      writeFileSync(summaryPath, "{}");
      expect(() => run({ gtasks: summaryPath })).toThrow(/overwrite|input/i);
      expect(readFileSync(backupPath, "utf8")).toBe("keep me");
      expect(readFileSync(areasFile, "utf8")).toBe("{}");
      expect(readFileSync(summaryPath, "utf8")).toBe("{}");
    });

    it("refuses a classify file inside the vault", () => {
      expect(() => run({ classifyOut: join(vault, "classify.json") })).toThrow(/Nothing was written/);
      untouched(join(vault, "classify.json"));
      untouched(join(out, `esmeworld-transfer-${TODAY}.json`));
    });
  });

  it("refuses to write when the result does not validate, and says so calmly", () => {
    expect(() => run({ today: "2026-13-45" })).toThrow(/Nothing was written/);
    expect(existsSync(join(out, `esmeworld-transfer-${TODAY}.json`))).toBe(false);
  });

  it("reads an --extra file; terminal still prints counts only", () => {
    const extra = join(dir, "extra.jsonl");
    writeFileSync(
      extra,
      JSON.stringify({ key: "x1", title: "Secret fixture title", kind: "idea", areaId: "inbox", tag: "from-daily-notes" }) + "\n",
    );
    const r = run({ extraFile: extra });
    const backup = parseBackup(readFileSync(join(out, `esmeworld-transfer-${TODAY}.json`), "utf8"));
    expect(backup.items.find((i) => i.title === "Secret fixture title")!.kind).toBe("idea");
    expect(r.lines.join("\n")).not.toMatch(/secret/i);
    expect(r.lines.join("\n")).toMatch(/vault review/i);
  });

  it("an unreadable --extra file is a calm error and writes nothing", () => {
    expect(() => run({ extraFile: join(dir, "missing.jsonl") })).toThrow(/extra file/i);
    expect(existsSync(join(out, `esmeworld-transfer-${TODAY}.json`))).toBe(false);
  });

  it("a bad areas file is a calm error and writes nothing", () => {
    const areasFile = join(dir, "bad.json");
    writeFileSync(areasFile, "not json");
    expect(() => run({ areasFile })).toThrow(/areas file/i);
    expect(existsSync(join(out, `esmeworld-transfer-${TODAY}.json`))).toBe(false);
  });
});
