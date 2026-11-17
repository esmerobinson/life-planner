import { db } from "./db";
import {
  listDayLogs, listWeekReviews, readDayLog, readWeekReview, removeDayLogVersion, reviewDoneDays, saveDayLog, saveWeekReview,
  type FormSession,
} from "./repo";
import { validJournal } from "./validate";
import { journalAad, sealJson } from "../journal/crypto";
import { EMPTY_DAY_LOG, EMPTY_WEEK_REVIEW, isDayLogEntry, isWeekReviewEntry } from "../journal/routine";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { clock, emptyDb } from "../together/testKit";

// The daily log and the weekly review, sealed and versioned like the learned words. Made-up words.

const DAY = "2026-11-15"; // a Sunday
const MAC = "device-pretend-mac-01";
const PHONE = "device-pretend-phone-1";

beforeEach(emptyDb);

async function key() {
  const jk = await keyFor("fake-journal-routine");
  await confirmedDevice(db, jk);
  return jk;
}
const session = (date = DAY): FormSession => ({ date, seen: [], submittedAt: null });

describe("the daily log", () => {
  it("saves sealed as she goes (not done), Done marks it done, and an edit after Done keeps it done", async () => {
    const jk = await key();
    const s = session();
    s.version = await saveDayLog(jk, MAC, { ...EMPTY_DAY_LOG, schedule: "partly" }, s);
    let day = await readDayLog(jk, DAY);
    expect(day).toMatchObject({ fields: { schedule: "partly", todos: null }, done: false, others: [] });
    s.version = await saveDayLog(jk, MAC, { ...EMPTY_DAY_LOG, schedule: "partly", scheduleNote: "Pretend Wobblefen note", todos: "yes" }, s, true);
    day = await readDayLog(jk, DAY);
    expect(day.done).toBe(true);
    const doneAt = day.submittedAt;
    // Edit: a new session from what she sees, keeping Done.
    const edit: FormSession = { date: DAY, seen: day.seen, submittedAt: day.submittedAt };
    await saveDayLog(jk, MAC, { ...day.fields, todos: "no" }, edit);
    day = await readDayLog(jk, DAY);
    expect(day).toMatchObject({ fields: { schedule: "partly", scheduleNote: "Pretend Wobblefen note", todos: "no" }, done: true, submittedAt: doneAt, others: [] });

    const rows = await db.journal.where("kind").equals("day-log").toArray();
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(validJournal(r)).toBe(true);
      expect(r.id).toMatch(new RegExp(`^day-log:${DAY}:${MAC}_[0-9a-z]+$`));
      expect(JSON.stringify(r)).not.toContain("Wobblefen");
      expect(JSON.stringify(r)).not.toContain("partly");
    }
  });

  it("two devices offline: both versions kept, the newest shown, the other listed; Remove takes only that one", async () => {
    const jk = await key();
    await saveDayLog(jk, MAC, { ...EMPTY_DAY_LOG, schedule: "yes", scheduleNote: "Pretend Mac words" }, session(), true);
    await new Promise((r) => setTimeout(r, 3));
    await saveDayLog(jk, PHONE, { ...EMPTY_DAY_LOG, todos: "no", todosNote: "Pretend phone words" }, session(), true);
    let day = await readDayLog(jk, DAY);
    expect(day.fields.todosNote).toBe("Pretend phone words");
    expect(day.others.map((o) => o.fields.scheduleNote)).toEqual(["Pretend Mac words"]);
    await removeDayLogVersion(jk, PHONE, day.others[0]!);
    day = await readDayLog(jk, DAY);
    expect(day).toMatchObject({ fields: { todosNote: "Pretend phone words" }, others: [], done: true });
  });

  it("a later write to a version she replaced shows it again (never hidden by an old look)", async () => {
    const jk = await key();
    const phone = session();
    phone.version = await saveDayLog(jk, PHONE, { ...EMPTY_DAY_LOG, schedule: "no" }, phone);
    const seen = (await readDayLog(jk, DAY)).seen;
    await new Promise((r) => setTimeout(r, 3));
    await saveDayLog(jk, MAC, { ...EMPTY_DAY_LOG, schedule: "yes" }, { date: DAY, seen, submittedAt: null });
    expect((await readDayLog(jk, DAY)).others).toEqual([]);
    await new Promise((r) => setTimeout(r, 3));
    await saveDayLog(jk, PHONE, { ...EMPTY_DAY_LOG, schedule: "no", scheduleNote: "Pretend later phone words" }, phone);
    const day = await readDayLog(jk, DAY);
    expect(day.fields.scheduleNote).toBe("Pretend later phone words");
    expect(day.others.map((o) => o.fields.schedule)).toEqual(["yes"]);
  });

  it("never writes over a row this key can't open, nor another device's row", async () => {
    const jk = await key();
    const other = await keyFor("fake-journal-routine-other");
    const id = `day-log:${DAY}:${MAC}_pretend1`;
    await db.journal.put({ id, kind: "day-log", date: DAY, fp: other.fp, ...(await sealJson(other.key, { v: 1 }, journalAad(id))) });
    await expect(saveDayLog(jk, MAC, { ...EMPTY_DAY_LOG, schedule: "yes" }, { ...session(), version: id })).rejects.toThrow();
    await expect(saveDayLog(jk, MAC, { ...EMPTY_DAY_LOG, schedule: "yes" }, { ...session(), version: `day-log:${DAY}:${PHONE}_x1` })).rejects.toThrow();
    expect((await readDayLog(jk, DAY)).unreadable).toBe(1);
  });

  it("lists past days newest first, and too-long notes are refused", async () => {
    const jk = await key();
    await saveDayLog(jk, MAC, { ...EMPTY_DAY_LOG, schedule: "yes" }, session("2026-11-13"), true);
    await saveDayLog(jk, MAC, { ...EMPTY_DAY_LOG, todos: "partly" }, session("2026-11-14"));
    await saveDayLog(jk, MAC, { ...EMPTY_DAY_LOG, todos: "no" }, session(DAY));
    expect((await listDayLogs(jk, DAY)).map((d) => [d.date, d.done])).toEqual([["2026-11-14", false], ["2026-11-13", true]]);
    await expect(saveDayLog(jk, MAC, { ...EMPTY_DAY_LOG, scheduleNote: "x".repeat(1001) }, session())).rejects.toThrow("too long");
  });
});

describe("after a Replace (a new device id)", () => {
  it("a box open across the Replace: its answers move to a new version under the new id, which keeps replacing the old one on every save", async () => {
    const jk = await key();
    const OLD = "device-pretend-old-0001";
    const NEW = "device-pretend-new-0002";
    const s = session();
    s.version = await saveDayLog(jk, OLD, { ...EMPTY_DAY_LOG, schedule: "yes" }, s);
    const { DEVICE_ID_META, FORMER_DEVICE_IDS_META } = await import("./deviceIds");
    await db.syncMeta.bulkPut([{ key: DEVICE_ID_META, value: NEW }, { key: FORMER_DEVICE_IDS_META, value: [OLD] }]);
    s.version = await saveDayLog(jk, OLD, { ...EMPTY_DAY_LOG, schedule: "yes", scheduleNote: "Pretend after" }, s);
    expect(s.version).toMatch(new RegExp(`^day-log:${DAY}:${NEW}_`));
    await saveDayLog(jk, OLD, { ...EMPTY_DAY_LOG, schedule: "yes", scheduleNote: "Pretend after, more" }, s);
    expect(await readDayLog(jk, DAY)).toMatchObject({ fields: { scheduleNote: "Pretend after, more" }, others: [] });
  });
});

describe("the weekly review", () => {
  const REVIEW = { well: "Pretend Thistlewick went well", inWay: "Pretend fog", values: 7, ifThen: "If pretend rain, then indoor walk", minDays: ["wed" as const, "mon" as const] };

  it("one per week (Monday to Sunday); it belongs to the day she pressed Done, even edited later in the week", async () => {
    const c = clock("2026-11-13T20:00:00"); // Friday
    const jk = await key();
    const s = session("2026-11-13");
    s.version = await saveWeekReview(jk, MAC, REVIEW, s, true);
    let week = await readWeekReview(jk, DAY);
    expect(week).toMatchObject({ day: "2026-11-13", done: true, fields: { ...REVIEW, minDays: ["mon", "wed"] } });
    // Sunday: an edit (filed under Sunday, its own session) keeps Done and the day it was done.
    c.set(`${DAY}T10:00:00`);
    await saveWeekReview(jk, MAC, { ...week.fields, values: 8 }, { date: DAY, seen: week.seen, submittedAt: week.submittedAt, doneOn: week.doneOn });
    week = await readWeekReview(jk, DAY);
    expect(week).toMatchObject({ day: "2026-11-13", fields: { values: 8 }, others: [], done: true });
    // The next week starts empty.
    expect(await readWeekReview(jk, "2026-11-16")).toMatchObject({ id: "", done: false, fields: EMPTY_WEEK_REVIEW });
    expect([...(await reviewDoneDays(jk))]).toEqual(["2026-11-13"]);
    expect((await listWeekReviews(jk, "2026-11-30")).map((w) => w.week)).toEqual(["2026-11-09"]);
  });

  it("C1: touched on Monday, done on Sunday: it belongs to Sunday (never the Monday it was first touched)", async () => {
    const c = clock("2026-11-09T09:00:00"); // Monday
    const jk = await key();
    const mon = session("2026-11-09");
    mon.version = await saveWeekReview(jk, MAC, { ...EMPTY_WEEK_REVIEW, values: 4 }, mon);
    expect(await readWeekReview(jk, DAY)).toMatchObject({ day: "2026-11-09", done: false });
    c.set(`${DAY}T19:00:00`); // Sunday: a new session, filed under Sunday, replacing Monday's version
    const shown = await readWeekReview(jk, DAY);
    await saveWeekReview(jk, MAC, { ...shown.fields, well: "Pretend Sunday words" }, { date: DAY, seen: shown.seen, submittedAt: null }, true);
    expect(await readWeekReview(jk, DAY)).toMatchObject({ day: DAY, done: true, others: [] });
    expect([...(await reviewDoneDays(jk))]).toEqual([DAY]);
  });

  it("an older entry without doneOn belongs to the app day of its Done (3am rule)", async () => {
    clock("2026-11-16T01:30:00"); // Monday 01:30: still Sunday in the app
    const jk = await key();
    await saveWeekReview(jk, MAC, REVIEW, session("2026-11-14"), true);
    // Written by an earlier build: no doneOn.
    const row = (await db.journal.where("kind").equals("week-review").toArray())[0]!;
    const { formRows } = await import("./journalRepo");
    const o = await formRows.open(jk, row, "week-review");
    if (o.state !== "ok") throw new Error("pretend row should open");
    const { doneOn: _d, ...older } = o.entry;
    await db.journal.put(await formRows.seal(jk, "week-review", row.date, row.id.slice(`week-review:${row.date}:`.length), older));
    expect((await readWeekReview(jk, DAY)).day).toBe(DAY);
  });

  it("a draft review (no Done) is kept and listed but doesn't count", async () => {
    const jk = await key();
    await saveWeekReview(jk, MAC, { ...EMPTY_WEEK_REVIEW, well: "Pretend draft words" }, session());
    expect(await reviewDoneDays(jk)).toEqual(new Set());
    expect((await listWeekReviews(jk, "2026-11-30"))[0]).toMatchObject({ done: false, fields: { well: "Pretend draft words" } });
  });
});

describe("shapes", () => {
  it("refuses entries it doesn't know", () => {
    const stamp = { v: 1, submittedAt: null, at: 1 };
    expect(isDayLogEntry({ ...stamp, ...EMPTY_DAY_LOG })).toBe(true);
    expect(isDayLogEntry({ ...stamp, ...EMPTY_DAY_LOG, schedule: "maybe" })).toBe(false);
    expect(isWeekReviewEntry({ ...stamp, ...EMPTY_WEEK_REVIEW, values: 10 })).toBe(true);
    expect(isWeekReviewEntry({ ...stamp, ...EMPTY_WEEK_REVIEW, values: 11 })).toBe(false);
    expect(isWeekReviewEntry({ ...stamp, ...EMPTY_WEEK_REVIEW, values: 0 })).toBe(false);
    expect(isWeekReviewEntry({ ...stamp, ...EMPTY_WEEK_REVIEW, minDays: ["mon", "mon"] })).toBe(false);
    expect(isWeekReviewEntry({ ...stamp, ...EMPTY_WEEK_REVIEW, minDays: ["funday"] })).toBe(false);
  });
});

describe("settled: a version she chose not to use stays listed, and no longer holds the day (fix round 2, R-C1)", () => {
  it("a new version naming the box's own as settled: both still there, the old one marked settled, nothing replaced", async () => {
    const jk = await key();
    const mac = session();
    mac.version = await saveDayLog(jk, MAC, { ...EMPTY_DAY_LOG, schedule: "yes", scheduleNote: "Pretend Mac words" }, mac);
    await new Promise((r) => setTimeout(r, 3));
    await saveDayLog(jk, PHONE, { ...EMPTY_DAY_LOG, schedule: "no", scheduleNote: "Pretend phone words" }, session());
    const both = await readDayLog(jk, DAY);
    expect(both.fields.scheduleNote).toBe("Pretend phone words");
    const macVersion = both.others[0]!;
    // She uses the Mac's answers: the phone's (shown) is settled, not replaced.
    await new Promise((r) => setTimeout(r, 3));
    const use: FormSession = { date: DAY, seen: macVersion.seen, settled: [...both.seen], submittedAt: null };
    use.version = await saveDayLog(jk, MAC, macVersion.fields, use);
    let day = await readDayLog(jk, DAY);
    expect(day.fields.scheduleNote).toBe("Pretend Mac words");
    expect(day.others.map((o) => [o.fields.scheduleNote, o.settled])).toEqual([["Pretend phone words", true]]);
    // Later saves of that session keep it settled; a new session from it carries it on.
    await saveDayLog(jk, MAC, { ...macVersion.fields, todos: "yes" }, use);
    day = await readDayLog(jk, DAY);
    expect(day.others.map((o) => o.settled)).toEqual([true]);
    await new Promise((r) => setTimeout(r, 3));
    await saveDayLog(jk, MAC, { ...day.fields, todosNote: "Pretend later" }, { date: DAY, seen: day.seen, settled: day.settledTokens, submittedAt: null });
    expect((await readDayLog(jk, DAY)).others.map((o) => o.settled)).toEqual([true]);
  });

  it("a later write to a settled version shows it as unsettled again (never hidden by an old choice)", async () => {
    const jk = await key();
    const phone = session();
    phone.version = await saveDayLog(jk, PHONE, { ...EMPTY_DAY_LOG, schedule: "no" }, phone);
    const shown = await readDayLog(jk, DAY);
    await new Promise((r) => setTimeout(r, 3));
    await saveDayLog(jk, MAC, { ...EMPTY_DAY_LOG, schedule: "yes" }, { date: DAY, seen: [], settled: shown.seen, submittedAt: null });
    expect((await readDayLog(jk, DAY)).others.map((o) => o.settled)).toEqual([true]);
    await new Promise((r) => setTimeout(r, 3));
    await saveDayLog(jk, PHONE, { ...EMPTY_DAY_LOG, schedule: "partly" }, phone);
    const day = await readDayLog(jk, DAY);
    expect(day.fields.schedule).toBe("partly");
    expect(day.others.map((o) => [o.fields.schedule, o.settled])).toEqual([["yes", false]]);
  });
});
