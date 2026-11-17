import { describe, expect, it } from "vitest";
import { DEFAULT_DUE_PREFS, type DuePrefs } from "../../../src/due/prefs";
import { GENERIC_LINE, MAX_DUE_TODAY, MAX_TIMED, wantedReminders, type DueItem } from "../../../src/due/rules";

// Monday 16 November 2026, New York (UTC-5).
const at = (local: string) => Date.parse(`${local}-05:00`);
const MORNING = at("2026-11-16T08:00:00");
const prefs = (p: Partial<DuePrefs> = {}): DuePrefs => ({ ...DEFAULT_DUE_PREFS, on: true, ...p });
const todo = (id: string, p: Partial<DueItem> = {}): DueItem => ({
  id, title: `Pretend ${id}`, kind: "task", status: "open", areaId: "admin", priority: 2, ...p,
});
const keys = (list: { key: string }[]) => list.map((r) => r.key);
const run = (items: DueItem[], now = MORNING, p: Partial<DuePrefs> = {}) => wantedReminders({ items, prefs: prefs(p), now });

describe("Due reminder rules", () => {
  it("nothing at all while Due is off", () => {
    expect(wantedReminders({ items: [todo("a", { due: "2026-11-16" })], prefs: DEFAULT_DUE_PREFS, now: MORNING })).toEqual([]);
  });

  it("Plan your day and Review your day at her times", () => {
    const list = run([], MORNING, { plan: "08:30", review: "22:15" });
    expect(list.find((r) => r.key === "esmeworld-20261116-plan")).toMatchObject({ title: "Plan your day", at: at("2026-11-16T08:30:00") });
    expect(list.find((r) => r.key === "esmeworld-20261116-review")).toMatchObject({ title: "Review your day", at: at("2026-11-16T22:15:00") });
  });

  it("before 3am it is still yesterday's reminders (the 3am rule)", () => {
    const list = run([], at("2026-11-17T02:30:00"));
    expect(keys(list)).toContain("esmeworld-20261116-review");
    expect(keys(list).every((k) => k.startsWith("esmeworld-20261116-"))).toBe(true);
    expect(keys(run([], at("2026-11-17T03:00:00")))).toContain("esmeworld-20261117-plan");
  });

  it("follows her time zone setting", () => {
    // 08:00 New York is 10:00 in São Paulo: the plan time is 09:00 there.
    const list = run([], MORNING, { timeZone: "America/Sao_Paulo" });
    expect(list.find((r) => r.key.endsWith("-plan"))!.at).toBe(Date.parse("2026-11-16T09:00:00-03:00"));
  });

  it("due today, overdue and pinned today, each at the first and second pass", () => {
    const list = run([
      todo("today", { due: "2026-11-16" }),
      todo("late", { due: "2026-11-10" }),
      todo("pinned", { pinnedDate: "2026-11-16" }),
      todo("later", { due: "2026-11-18" }),
      todo("moved", { due: "2026-11-10", pinnedDate: "2026-11-20" }),
      todo("hidden", { due: "2026-11-16", hiddenOn: "2026-11-16" }),
      todo("done", { due: "2026-11-16", status: "done", completedAt: "2026-11-15" }),
      todo("idea", { due: "2026-11-16", kind: "idea" }),
    ]);
    const first = list.filter((r) => r.kind === "due1");
    expect(keys(first).sort()).toEqual(["esmeworld-20261116-d1-late", "esmeworld-20261116-d1-pinned", "esmeworld-20261116-d1-today"]);
    expect(first[0]!.at).toBe(at("2026-11-16T11:00:00"));
    const second = list.filter((r) => r.kind === "due2");
    expect(second).toHaveLength(3);
    expect(second[0]!.at).toBe(at("2026-11-16T17:00:00"));
    expect(list.find((r) => r.key.endsWith("d1-today"))!.title).toBe("Pretend today");
  });

  it("habits planned for today and not yet done today", () => {
    const list = run([
      todo("mon", { recur: ["mon", "wed"] }),
      todo("tue", { recur: ["tue"] }),
      todo("doneToday", { recur: ["mon"], doneToday: true }),
      todo("inboxHabit", { recur: ["mon"], areaId: "inbox" }),
    ]);
    expect(keys(list.filter((r) => r.kind === "due1"))).toEqual(["esmeworld-20261116-d1-mon"]);
  });

  it("priority 1 and habits first, and never more than the cap", () => {
    const many = Array.from({ length: 12 }, (_, i) => todo(`p3-${String(i).padStart(2, "0")}`, { priority: 3, due: "2026-11-16" }));
    const list = run([...many, todo("habit", { recur: ["mon"], priority: 3 }), todo("urgent", { priority: 1, due: "2026-11-16" })]);
    const first = list.filter((r) => r.kind === "due1");
    expect(first).toHaveLength(MAX_DUE_TODAY);
    expect(keys(first).slice(0, 2).sort()).toEqual(["esmeworld-20261116-d1-habit", "esmeworld-20261116-d1-urgent"]);
    expect(list.filter((r) => r.kind === "due2")).toHaveLength(MAX_DUE_TODAY);
  });

  it("a timed to-do: an alert its lead before, and not in the due-today passes", () => {
    const list = run([todo("dentist", { pinnedDate: "2026-11-16", time: "15:00" }), todo("call", { due: "2026-11-16", time: "09:30" })], MORNING, { leadMinutes: 20 });
    const timed = list.filter((r) => r.kind === "timed");
    expect(timed.map((r) => [r.key, r.at])).toEqual([
      ["esmeworld-20261116-t-call", at("2026-11-16T09:10:00")],
      ["esmeworld-20261116-t-dentist", at("2026-11-16T14:40:00")],
    ]);
    expect(timed[1]!.title).toBe("Pretend dentist");
    expect(list.filter((r) => r.kind === "due1")).toEqual([]);
  });

  it("a timed to-do on another day, done, or without a day makes no timed alert", () => {
    const list = run([
      todo("tomorrow", { due: "2026-11-17", time: "15:00" }),
      todo("done", { due: "2026-11-16", time: "15:00", status: "done", completedAt: "2026-11-16" }),
      todo("noDay", { time: "15:00" }),
      todo("bad", { due: "2026-11-16", time: "25:00" }),
    ]);
    expect(list.filter((r) => r.kind === "timed")).toEqual([]);
    // A broken time is just a to-do due today.
    expect(keys(list.filter((r) => r.kind === "due1"))).toEqual(["esmeworld-20261116-d1-bad"]);
  });

  it("a 1am meeting tomorrow (calendar) belongs to tonight", () => {
    const list = run([todo("late", { due: "2026-11-17", time: "01:00" })]);
    expect(list.filter((r) => r.kind === "timed").map((r) => [r.key, r.at])).toEqual([["esmeworld-20261117-t-late", at("2026-11-17T00:45:00")]]);
  });

  it("timed alerts are capped too", () => {
    const many = Array.from({ length: MAX_TIMED + 3 }, (_, i) => todo(`m${i}`, { due: "2026-11-16", time: `1${i % 10}:0${i % 6}` }));
    expect(run(many).filter((r) => r.kind === "timed")).toHaveLength(MAX_TIMED);
  });

  it("a 03:05 meeting's 02:50 alert is wanted before 3am, under the meeting's own day (review M3)", () => {
    const item = todo("early", { due: "2026-11-17", time: "03:05" });
    const before = run([item], at("2026-11-17T02:30:00"));
    const after = run([item], at("2026-11-17T03:00:00"));
    const pick = (l: ReturnType<typeof run>) => l.filter((r) => r.kind === "timed").map((r) => [r.key, r.at]);
    expect(pick(before)).toEqual([["esmeworld-20261117-t-early", at("2026-11-17T02:50:00")]]);
    // After 3am the same key (so the same reminder, never a second one).
    expect(pick(after)).toEqual(pick(before));
  });

  it("a timed to-do added after its lead but before the meeting: sent a minute from now (review M3)", () => {
    const list = run([todo("soon", { due: "2026-11-16", time: "08:10" })], MORNING);
    const t = list.find((r) => r.kind === "timed")!;
    expect(t.at).toBe(at("2026-11-16T07:55:00"));
    expect(t.sendAt).toBe(MORNING + 60_000);
    // Once the meeting itself is within the minute, nothing.
    expect(run([todo("now", { due: "2026-11-16", time: "08:00" })], MORNING).some((r) => r.kind === "timed")).toBe(false);
  });

  it("an old pin is ignored for the time's day, as Today ignores it (review M4)", () => {
    const list = run([todo("oldpin", { pinnedDate: "2026-11-10", due: "2026-11-16", time: "15:00" })]);
    expect(keys(list.filter((r) => r.kind === "timed"))).toEqual(["esmeworld-20261116-t-oldpin"]);
  });

  describe("the 1pm motivation nudge", () => {
    const NOON = at("2026-11-16T12:40:00");
    it("is not wanted until half an hour before", () => {
      expect(run([], at("2026-11-16T12:20:00")).some((r) => r.kind === "nudge")).toBe(false);
      expect(run([], NOON).find((r) => r.kind === "nudge")).toMatchObject({ key: "esmeworld-20261116-nudge", at: at("2026-11-16T13:00:00") });
    });

    it("uses her own lines in turn, one a day, and a gentle line when she has none", () => {
      const lines = ["First line", "Second line", "Third line"];
      const today = run([], NOON, { lines }).find((r) => r.kind === "nudge")!.title;
      const tomorrow = run([], at("2026-11-17T12:40:00"), { lines }).find((r) => r.kind === "nudge")!.title;
      expect(lines).toContain(today);
      expect(lines.indexOf(tomorrow)).toBe((lines.indexOf(today) + 1) % 3);
      expect(run([], NOON).find((r) => r.kind === "nudge")!.title).toBe(GENERIC_LINE);
    });

    it("not when something was ticked off today: a to-do, a habit or a session", () => {
      expect(run([todo("d", { status: "done", completedAt: "2026-11-16" })], NOON).some((r) => r.kind === "nudge")).toBe(false);
      expect(run([todo("h", { recur: ["tue"], doneToday: true })], NOON).some((r) => r.kind === "nudge")).toBe(false);
      expect(run([todo("p", { sessionDoneToday: true })], NOON).some((r) => r.kind === "nudge")).toBe(false);
      // Done yesterday doesn't count.
      expect(run([todo("y", { status: "done", completedAt: "2026-11-15" })], NOON).some((r) => r.kind === "nudge")).toBe(true);
    });
  });

  it("titles are short and plain; odd ids are made safe", () => {
    const list = run([todo("weird id/with spaces", { due: "2026-11-16", title: `  ${"Long ".repeat(40)}\nline ` })]);
    const r = list.find((x) => x.kind === "due1")!;
    expect(r.key).toMatch(/^esmeworld-20261116-d1-h[0-9a-f]{8}$/);
    expect(r.title.length).toBeLessThanOrEqual(100);
    expect(r.title).not.toMatch(/\n|^\s/);
  });

  it("is the same every time for the same moment (pure)", () => {
    const items = [todo("a", { due: "2026-11-16" }), todo("b", { recur: ["mon"] })];
    expect(run(items)).toEqual(run(items));
  });
});
