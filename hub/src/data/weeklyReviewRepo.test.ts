import { db } from "./db";
import {
  listReviewWeeks, listWeeklyReviews, readWeeklyReview, reviewDoneDays, reviewWeekDone, saveWeekReview, saveWeeklyReview,
  type FormSession,
} from "./repo";
import { validJournal } from "./validate";
import { EMPTY_WEEK_REVIEW } from "../journal/routine";
import { EMPTY_WEEKLY_REVIEW } from "../journal/weeklyReview";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { clock, emptyDb } from "../together/testKit";

// Weekly review v2's rows: sealed, a version per device, filed under the week's Monday, belonging
// to the day she pressed Done (3am rule); old and new reviews never count twice. Made-up words.

const LAST = "2026-11-16"; // a Monday
const THIS = "2026-11-23"; // the next Monday
const MAC = "device-pretend-mac-01";
const PHONE = "device-pretend-phone-1";

beforeEach(emptyDb);

async function key() {
  const jk = await keyFor("fake-journal-weekly-v2");
  await confirmedDevice(db, jk);
  return jk;
}
const session = (week: string): FormSession => ({ date: week, seen: [], submittedAt: null });
const WORDS = { ...EMPTY_WEEKLY_REVIEW, selfHarm: "yes" as const, selfHarmWhat: "Pretend Quindle happened", fight: "no" as const, proud: "Pretend Quindle sketch" };

it("saves sealed under the week's Monday as she goes; Done belongs to the day she pressed it", async () => {
  const c = clock(`${THIS}T10:00:00`); // Monday: she does last week's review
  const jk = await key();
  const s = session(LAST);
  s.version = await saveWeeklyReview(jk, MAC, WORDS, s);
  expect(await readWeeklyReview(jk, LAST)).toMatchObject({ fields: WORDS, done: false });
  c.set(`${THIS}T10:05:00`);
  await saveWeeklyReview(jk, MAC, { ...WORDS, more: "Pretend more" }, s, true);
  const day = await readWeeklyReview(jk, LAST);
  expect(day).toMatchObject({ done: true, doneOn: THIS, day: THIS, fields: { more: "Pretend more" } });
  expect(await readWeeklyReview(jk, THIS)).toMatchObject({ id: "", done: false });

  const rows = await db.journal.where("kind").equals("weekly-review").toArray();
  expect(rows.length).toBe(1);
  for (const r of rows) {
    expect(validJournal(r)).toBe(true);
    expect(r.date).toBe(LAST);
    expect(r.id).toMatch(new RegExp(`^weekly-review:${LAST}:${MAC}_[0-9a-z]+$`));
    for (const w of ["Quindle", "selfHarm", "yes", "Pretend"]) expect(JSON.stringify(r)).not.toContain(w);
  }
  expect([...(await reviewDoneDays(jk))]).toEqual([THIS]);
});

it("the 3am rule: Done at 01:30 on Monday belongs to Sunday", async () => {
  clock(`${THIS}T01:30:00`);
  const jk = await key();
  await saveWeeklyReview(jk, MAC, WORDS, session(LAST), true);
  expect(await readWeeklyReview(jk, LAST)).toMatchObject({ done: true, day: "2026-11-22" });
});

it("only ever filed under a Monday", async () => {
  const jk = await key();
  await expect(saveWeeklyReview(jk, MAC, WORDS, session("2026-11-18"))).rejects.toThrow();
  expect(await db.journal.where("kind").equals("weekly-review").count()).toBe(0);
});

it("two devices offline: both kept, the newest shown, the other listed (nothing cleared)", async () => {
  const c = clock(`${THIS}T09:00:00`);
  const jk = await key();
  await saveWeeklyReview(jk, MAC, { ...WORDS, more: "Pretend Mac words" }, session(THIS), true);
  c.advance(5000);
  await saveWeeklyReview(jk, PHONE, { ...EMPTY_WEEKLY_REVIEW, dbt: "Pretend phone words" }, session(THIS));
  const day = await readWeeklyReview(jk, THIS);
  expect(day.fields.dbt).toBe("Pretend phone words");
  expect(day.others.map((o) => o.fields.more)).toEqual(["Pretend Mac words"]);
  expect((await listWeeklyReviews(jk)).map((w) => w.week)).toEqual([THIS]);
});

describe("old and new reviews never count twice", () => {
  it("the same week done both ways counts once, on the new one's day; an old-only week still counts", async () => {
    const c = clock("2026-11-15T19:00:00");
    const jk = await key();
    // Old kind, week of 9 Nov, Done Sunday 15th.
    await saveWeekReview(jk, MAC, { ...EMPTY_WEEK_REVIEW, well: "Pretend old Larrow week" }, { date: "2026-11-15", seen: [], submittedAt: null }, true);
    // Old kind, week of 16 Nov, Done Sunday 22nd.
    c.set("2026-11-22T19:00:00");
    await saveWeekReview(jk, MAC, { ...EMPTY_WEEK_REVIEW, well: "Pretend old Larrow again" }, { date: "2026-11-22", seen: [], submittedAt: null }, true);
    expect([...(await reviewDoneDays(jk))].sort()).toEqual(["2026-11-15", "2026-11-22"]);
    expect(await reviewWeekDone(jk, LAST)).toBe(true);
    expect(await reviewWeekDone(jk, THIS)).toBe(false);
    // The new kind for the week of 16 Nov too, Done Monday 23rd: that week counts once, on the 23rd.
    c.set(`${THIS}T10:00:00`);
    await saveWeeklyReview(jk, MAC, WORDS, session(LAST), true);
    expect([...(await reviewDoneDays(jk))].sort()).toEqual(["2026-11-15", THIS]);
    const weeks = await listReviewWeeks(jk);
    expect(weeks.map((w) => [w.week, !!w.v1, !!w.v2, w.day])).toEqual([
      [LAST, true, true, THIS],
      ["2026-11-09", true, false, "2026-11-15"],
    ]);
  });

  it("a draft (no Done) of either kind never counts, and doesn't make the week done", async () => {
    const jk = await key();
    await saveWeeklyReview(jk, MAC, WORDS, session(LAST));
    await saveWeekReview(jk, MAC, { ...EMPTY_WEEK_REVIEW, well: "Pretend draft" }, { date: "2026-11-20", seen: [], submittedAt: null });
    expect(await reviewDoneDays(jk)).toEqual(new Set());
    expect(await reviewWeekDone(jk, LAST)).toBe(false);
    expect((await listReviewWeeks(jk)).map((w) => [w.week, w.day])).toEqual([[LAST, null]]);
  });
});
