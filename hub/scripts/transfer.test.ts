import { beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "../src/data/db";
import { parseBackup, restoreBackup } from "../src/data/backup";
import { buildTransfer, runTransfer, type TransferInputs } from "./transfer";

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
    expect(t.counts.goals).toBe(10);
    expect(t.counts.nextSteps).toBe(3);
    expect(t.counts.habits).toBe(4);
    expect(t.counts.backlogItems).toBe(12);
    expect(t.counts.gtasksAdded).toBe(2);
    expect(t.counts.gtasksDuplicates).toBe(2);
    expect(t.backup.items).toHaveLength(12 + 2 + 3 + 4);
  });

  it("goals carry milestones, why and cadence; next steps are linked; habits repeat daily", () => {
    const { backup } = buildTransfer(inputs(), TODAY);
    const writing = backup.goals.find((g) => g.title === "Writing")!;
    expect(writing.milestones).toHaveLength(2);
    expect(writing.why).toContain("small pretend zines");
    expect(writing.cadence).toContain("Weekly:");
    expect(backup.goals.every((g) => g.areaId !== "inbox")).toBe(true);
    const zine = backup.goals.find((g) => g.title === "Finish the pretend zine")!;
    const step = backup.items.find((i) => i.title === "Write the ending scene")!;
    expect(step.goalId).toBe(zine.id);
    expect(zine.deadline).toBe("2028-02-29");
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
      "Items by area", "Goals", "Monthly goals and next steps", "Daily habits",
      "Google Tasks skipped as the same title", "Notes", "How to load this", "Still in your Inbox",
    ]) {
      expect(summary).toContain(h);
    }
    expect(summary).toContain("Finish the pretend zine");
    expect(summary).toContain("Write the ending scene");
    expect(summary).toContain("Merge");
  });

  it("a missing input is skipped with a note", () => {
    const t = buildTransfer({ backlog: read("Backlog.md"), missing: ["Goals.md"] }, TODAY);
    expect(t.backup.goals).toEqual([]);
    expect(t.notes.some((n) => n.reason.includes("Goals.md") && /skipped/.test(n.reason))).toBe(true);
    expect(t.summary).toContain("Goals.md");
  });

  it("refuses an invalid result", () => {
    const huge = "## Writing\n- Identity: " + "x".repeat(5000);
    expect(() => buildTransfer({ goals: huge, missing: [] }, TODAY)).toThrow(/not valid|does not validate/i);
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

  it("the same keys sort the same items on a second run with fresh ids", () => {
    const areas = { "gtasks:a2": "admin" };
    const a = buildTransfer(inputs(), TODAY, { areas });
    const b = buildTransfer(inputs(), TODAY, { areas });
    const id = (t: typeof a) => t.backup.items.find((i) => i.title === "Post the invented parcel")!.id;
    expect(id(a)).not.toBe(id(b));
    expect(b.backup.items.find((i) => i.title === "Post the invented parcel")!.areaId).toBe("admin");
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

  it("refuses to write when the result does not validate, and says so calmly", () => {
    writeFileSync(join(vault, "Goals.md"), "## Writing\n- Identity: " + "x".repeat(5000));
    expect(() => run()).toThrow(/Nothing was written/);
    expect(existsSync(join(out, `esmeworld-transfer-${TODAY}.json`))).toBe(false);
  });

  it("a bad areas file is a calm error and writes nothing", () => {
    const areasFile = join(dir, "bad.json");
    writeFileSync(areasFile, "not json");
    expect(() => run({ areasFile })).toThrow(/areas file/i);
    expect(existsSync(join(out, `esmeworld-transfer-${TODAY}.json`))).toBe(false);
  });
});
