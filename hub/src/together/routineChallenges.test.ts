import { db } from "../data/db";
import { exportBackup, restoreBackup } from "../data/backup";
import { listDayLogs, saveDayLog, saveSharePrivate } from "../data/repo";
import { EMPTY_DAY_LOG, type DayLogFields } from "../journal/routine";
import { getDeviceId } from "../sync/engine";
import { readSent } from "./store";
import { sendToTogether, ANSWERS_DELAY_MS } from "./sender";
import {
  isFinal, ROUTINE_CHALLENGES, routineDayPayloads, SEND_ROUTINE_CHALLENGES, sendRoutineChallenges, type RoutineCtx,
} from "./routineChallenges";
import { clock, COUPLE, DEVICE, emptyDb, guardedFetch, journalDay, ME, PARTNER, signedIn, type Clock } from "./testKit";
import type { FakeSupabase } from "./fakeSupabase";

// The daily log's two Together challenges (Oliver's answer, 16 Nov 2026; review fix round 1).
// Challenge days are INSERT ONLY, so a day goes once, only when final (her day over at 3am, then
// a whole day more), only with Done, never on a private day, never edited or hidden afterwards.
// The link never makes the challenges: Oliver does; a day goes only into one that is hers and
// accepted. The switch is off unless a test turns it on. Against the fake Together, which refuses
// any change to those days; every request recorded. Made-up words only.

const D = "2026-11-10"; // a Tuesday
const D2 = "2026-11-11";
const FINAL = "2026-11-13T03:30:00"; // both days ended, and a whole day more has passed
const NOTE_S = "Pretend Fennick schedule note";
const NOTE_T = "Pretend Fennick to-do note";
const LOG: DayLogFields = { schedule: "partly", scheduleNote: NOTE_S, todos: "no", todosNote: NOTE_T };

beforeEach(emptyDb);

const SCHEDULE = ROUTINE_CHALLENGES.schedule.id;
const TODOS = ROUTINE_CHALLENGES.todos.id;
/** Every request touching the daily log's challenges or their days, or making any challenge. */
const routineRequests = (fake: FakeSupabase) =>
  fake.requests.filter((r) => /esme-(daily-|schedule-|todos-)/.test(decodeURIComponent(r.url) + r.body) || (r.url.includes("/rest/v1/challenges") && r.method === "POST"));
const dayPosts = (fake: FakeSupabase) => fake.requests.filter((r) => r.method === "POST" && r.url.includes("challenge_days") && /esme-/.test(r.body));

/** Oliver's two challenges, as he'd make them: for Esme, accepted by her. */
function ready(fake: FakeSupabase, extra: { for_user?: string | null; accepted_at?: string | null; breaks_on?: string } = {}) {
  for (const id of [SCHEDULE, TODOS]) fake.addChallenge({ id, couple_id: COUPLE, name: `Pretend ${id}`, for_user: ME, accepted_at: "2026-11-01T10:00:00Z", breaks_on: "goal", ...extra });
}

async function setUp(opts: { log?: DayLogFields; done?: boolean; at?: string; challenges?: boolean } = {}) {
  const c = clock(`${D}T09:00:00`);
  const fake = await signedIn(c);
  if (opts.challenges ?? true) ready(fake);
  const { jk } = await journalDay(D, {});
  await saveDayLog(jk, DEVICE, opts.log ?? LOG, { date: D, seen: [], submittedAt: null }, opts.done ?? true);
  c.set(opts.at ?? FINAL);
  return { c, fake, jk };
}

const press = (fake: FakeSupabase, c: Clock, f: typeof fetch = fake.fetch, extra: object = {}) =>
  sendToTogether({ fetch: f, now: c.now, batchPauseMs: 0, routineChallenges: true, ...extra });

describe("the seam: a day's log as challenge days", () => {
  it("one per answered question, every answer honestly (No too): the answer first, her note on the next line; fixed ids", () => {
    expect(routineDayPayloads(D, LOG, COUPLE)).toEqual([
      { key: "schedule", date: D, body: { id: `esme-schedule-${D}`, couple_id: COUPLE, challenge_id: SCHEDULE, day: D, note: `Partly\n${NOTE_S}` } },
      { key: "todos", date: D, body: { id: `esme-todos-${D}`, couple_id: COUPLE, challenge_id: TODOS, day: D, note: `No\n${NOTE_T}` } },
    ]);
    expect(routineDayPayloads(D, { ...EMPTY_DAY_LOG, todos: "yes", scheduleNote: "Pretend note, no answer" }, COUPLE).map((p) => p.body.note)).toEqual(["Yes"]);
  });

  it("final: her day ended at 03:00 and a whole day more has passed", () => {
    const at = (s: string) => new Date(s).getTime();
    expect(isFinal(D, at("2026-11-11T02:59:00"), 0)).toBe(false);
    expect(isFinal(D, at("2026-11-11T03:00:00"), 0)).toBe(true);
    expect(isFinal(D, at("2026-11-12T02:59:00"), ANSWERS_DELAY_MS)).toBe(false);
    expect(isFinal(D, at("2026-11-12T03:00:00"), ANSWERS_DELAY_MS)).toBe(true);
  });
});

describe("the switch and the challenges (review C2)", () => {
  it("off by default: a press sends nothing of the daily log", async () => {
    expect(SEND_ROUTINE_CHALLENGES.on).toBe(false);
    const { c, fake } = await setUp();
    await sendToTogether({ fetch: fake.fetch, now: c.now, batchPauseMs: 0 });
    expect(routineRequests(fake)).toEqual([]);
  });

  for (const [what, setup, why] of [
    ["missing", (_f: FakeSupabase) => undefined, "missing"],
    ["for nobody", (f: FakeSupabase) => ready(f, { for_user: null }), "not-hers"],
    ["for Oliver", (f: FakeSupabase) => ready(f, { for_user: PARTNER }), "not-hers"],
    ["not accepted yet", (f: FakeSupabase) => ready(f, { accepted_at: null }), "not-accepted"],
    ["not goal challenges (R-M2)", (f: FakeSupabase) => ready(f, { breaks_on: "hit" }), "not-goal"],
  ] as const) {
    it(`the challenges ${what}: nothing goes, nothing is ever made, and the box is told why`, async () => {
      const { c, fake } = await setUp({ challenges: false });
      setup(fake);
      await press(fake, c);
      expect(dayPosts(fake)).toEqual([]);
      expect(fake.requests.filter((r) => r.method === "POST" && r.url.includes("/rest/v1/challenges"))).toEqual([]);
      expect((await readSent(db))!.routineWaiting).toBe(why);
    });
  }

  it("ready (Esme's, accepted): each answer inserted once, as is; a replay sends nothing", async () => {
    const { c, fake } = await setUp();
    expect(await press(fake, c)).toMatchObject({ kind: "ok" });
    expect(fake.liveDays(SCHEDULE)).toEqual([expect.objectContaining({ id: `esme-schedule-${D}`, day: D, note: `Partly\n${NOTE_S}`, by: ME })]);
    expect(fake.liveDays(TODOS)).toEqual([expect.objectContaining({ id: `esme-todos-${D}`, note: `No\n${NOTE_T}` })]);
    const sent = (await readSent(db))!;
    expect(sent.routine).toEqual({ [`schedule:${D}`]: "sent", [`todos:${D}`]: "sent" });
    expect(sent.routineWaiting).toBeUndefined();
    const n = dayPosts(fake).length;
    await press(fake, c);
    await press(fake, c, fake.fetch, { retryRefused: true });
    expect(dayPosts(fake).length).toBe(n);
  });
});

describe("when a day may go", () => {
  for (const at of [`${D}T22:00:00`, "2026-11-11T02:30:00", "2026-11-11T20:00:00", "2026-11-12T02:59:00"]) {
    it(`not final yet (${at}): nothing of the log goes`, async () => {
      const { c, fake } = await setUp({ at });
      const rec = guardedFetch(fake.fetch, () => [NOTE_S, NOTE_T, "esme-schedule", "esme-todos"], c.now);
      await press(fake, c, rec.fetch);
      expect(rec.violations).toEqual([]);
    });
  }

  for (const part of ["checkin", "exercise"] as const) {
    it(`a private day (${part} ticked): nothing ever goes, on any press, however late`, async () => {
      const { c, fake, jk } = await setUp();
      await saveSharePrivate(jk, D, part, true);
      const rec = guardedFetch(fake.fetch, () => [NOTE_S, NOTE_T, `esme-schedule-${D}`, `esme-todos-${D}`], c.now);
      for (const when of [FINAL, "2026-11-20T09:00:00"]) {
        c.set(when);
        await press(fake, c, rec.fetch, { retryRefused: true });
      }
      expect(rec.violations).toEqual([]);
      expect(fake.dayRows(SCHEDULE)).toEqual([]);
    });
  }

  it("a log without Done never goes", async () => {
    const { c, fake } = await setUp({ done: false });
    const rec = guardedFetch(fake.fetch, () => [NOTE_S, NOTE_T, "esme-schedule", "esme-todos"], c.now);
    await press(fake, c, rec.fetch);
    expect(rec.violations).toEqual([]);
  });

  it("another device's answers not settled: the day waits, and the box is told", async () => {
    const { c, fake, jk } = await setUp();
    await saveDayLog(jk, "device-pretend-phone-1", { ...EMPTY_DAY_LOG, schedule: "yes" }, { date: D, seen: [], submittedAt: null }, true);
    await press(fake, c);
    expect(dayPosts(fake)).toEqual([]);
    expect((await readSent(db))!.routineHeld).toEqual({ versions: 1 });
  });

  it("a version she chose not to use (settled, still listed) no longer holds the day: it goes", async () => {
    const { c, fake, jk } = await setUp();
    await saveDayLog(jk, "device-pretend-phone-1", { ...EMPTY_DAY_LOG, schedule: "yes" }, { date: D, seen: [], submittedAt: null }, true);
    const day = (await listDayLogs(jk, "2026-11-30"))[0]!;
    const mine = day.others.find((o) => o.fields.scheduleNote === NOTE_S)!;
    await saveDayLog(jk, DEVICE, mine.fields, { date: D, seen: mine.seen, settled: day.seen, submittedAt: mine.submittedAt, doneOn: mine.doneOn });
    expect((await listDayLogs(jk, "2026-11-30"))[0]!.others.map((o) => o.settled)).toEqual([true]);
    await press(fake, c);
    expect(fake.liveDays(SCHEDULE).map((r) => r.note)).toEqual([`Partly\n${NOTE_S}`]);
  });

  it("once in, never changed: an edit afterwards sends nothing (the fake refuses any change to these days)", async () => {
    const { c, fake, jk } = await setUp();
    await press(fake, c);
    const day = (await listDayLogs(jk, "2026-11-30"))[0]!;
    await saveDayLog(jk, DEVICE, { ...day.fields, todos: "yes", todosNote: "Pretend later edit" }, { date: D, seen: day.seen, submittedAt: day.submittedAt });
    const n = fake.requests.length;
    const rec = guardedFetch(fake.fetch, () => ["Pretend later edit"], c.now);
    await press(fake, c, rec.fetch);
    await sendToTogether({ fetch: rec.fetch, now: c.now, mode: "hide", routineChallenges: true });
    expect(rec.violations).toEqual([]);
    expect(fake.requests.slice(n).filter((r) => r.method !== "GET" && /esme-/.test(decodeURIComponent(r.url) + r.body))).toEqual([]);
    expect(fake.liveDays(TODOS)[0]!.note).toBe(`No\n${NOTE_T}`);
  });

  it("the automatic runs (hide) never send it", async () => {
    const { c, fake } = await setUp();
    await sendToTogether({ fetch: fake.fetch, now: c.now, mode: "hide", routineChallenges: true });
    expect(routineRequests(fake)).toEqual([]);
  });

  it("after a real Replace, until sync has caught up (sync off: 24 h): nothing goes", async () => {
    const { c, fake } = await setUp();
    const before = await getDeviceId(db);
    await restoreBackup(JSON.parse(JSON.stringify(await exportBackup("2026-11-13"))), "replace");
    expect(await getDeviceId(db)).not.toBe(before);
    await press(fake, c);
    expect(dayPosts(fake)).toEqual([]);
    c.advance(ANSWERS_DELAY_MS + 60_000);
    await press(fake, c);
    expect(dayPosts(fake)).toHaveLength(2); // once the hold is over
  });
});

describe("duplicates and refusals (review I2)", () => {
  it("an insert whose reply was lost goes in once: the next press meets our own id and counts it sent", async () => {
    const { c, fake } = await setUp();
    fake.inject({ lostReply: true, when: (r) => r.method === "POST" && r.body.includes(`esme-schedule-${D}`) });
    expect(await press(fake, c)).toMatchObject({ kind: "offline" });
    expect((await readSent(db))!.routine).toMatchObject({ [`schedule:${D}`]: "maybe" });
    await press(fake, c);
    expect(fake.dayRows(SCHEDULE)).toHaveLength(1);
    expect(fake.dayRows(TODOS)).toHaveLength(1);
    expect((await readSent(db))!.routine).toEqual({ [`schedule:${D}`]: "sent", [`todos:${D}`]: "sent" });
  });

  it("a day she already logged by hand in Together is left exactly as she wrote it, and never tried again", async () => {
    const { c, fake } = await setUp();
    fake.logByHand({ couple_id: COUPLE, challenge_id: SCHEDULE, day: D, note: "Pretend by hand", by: ME });
    await press(fake, c);
    expect(fake.dayRows(SCHEDULE).map((r) => r.note)).toEqual(["Pretend by hand"]);
    expect((await readSent(db))!.routine![`schedule:${D}`]).toBe("hand");
    const n = dayPosts(fake).length;
    await press(fake, c);
    expect(dayPosts(fake).length).toBe(n);
  });

  it("a 409 that isn't our own id (a missing challenge, 23503) is never counted as sent: it goes on the next press", async () => {
    const { c, fake } = await setUp();
    fake.inject({ status: 409, body: { code: "23503", message: "fake: no such challenge" }, when: (r) => r.method === "POST" && r.body.includes(`esme-todos-${D}`) });
    await press(fake, c);
    const sent = (await readSent(db))!;
    expect(sent.routine![`todos:${D}`]).toBeUndefined();
    expect(sent.routineProblems).toBe(1);
    await press(fake, c);
    expect(fake.liveDays(TODOS)).toHaveLength(1);
    expect((await readSent(db))!.routine![`todos:${D}`]).toBe("sent");
  });
});

describe("read again right before each insert (review I1)", () => {
  async function twoDays() {
    const c = clock(`${D}T09:00:00`);
    const { jk } = await journalDay(D, {});
    await saveDayLog(jk, DEVICE, LOG, { date: D, seen: [], submittedAt: null }, true);
    await saveDayLog(jk, DEVICE, { ...LOG, scheduleNote: "Pretend second-day note" }, { date: D2, seen: [], submittedAt: null }, true);
    c.set(FINAL);
    const posted: unknown[] = [];
    const ctx = (onFirstPost: () => Promise<void>) => {
      let first = true;
      return {
        sent: { userId: ME, since: D, salt: "00", refused: {} }, auth: { coupleId: COUPLE, userId: ME }, jk, restoredUnpulled: false, writes: 0,
        now: c.now, save: async () => undefined,
        call: async (method: string, path: string, body: unknown) => {
          if (method === "GET" && path.startsWith("challenges")) return { kind: "ok", body: [{ for_user: ME, accepted_at: "2026-11-01T10:00:00Z", breaks_on: "goal" }] };
          if (method === "POST") {
            posted.push(body);
            if (first) {
              first = false;
              await onFirstPost();
            }
          }
          return { kind: "ok", body: null };
        },
      } as unknown as RoutineCtx;
    };
    return { jk, ctx, posted };
  }
  const opts = { maxWrites: 50, between: async () => undefined };

  it("the next day ticked private while the press goes on: it never goes", async () => {
    const { jk, ctx, posted } = await twoDays();
    await sendRoutineChallenges(ctx(() => saveSharePrivate(jk, D2, "checkin", true)), await listDayLogs(jk, "2026-11-30"), ANSWERS_DELAY_MS, opts);
    expect(JSON.stringify(posted)).not.toContain(D2);
    expect(posted).toHaveLength(2); // the first day's two
  });

  it("another device's version of the next day arriving meanwhile: it waits", async () => {
    const { jk, ctx, posted } = await twoDays();
    const arrive = async () => void (await saveDayLog(jk, "device-pretend-phone-1", { ...EMPTY_DAY_LOG, todos: "yes" }, { date: D2, seen: [], submittedAt: null }, true));
    await sendRoutineChallenges(ctx(arrive), await listDayLogs(jk, "2026-11-30"), ANSWERS_DELAY_MS, opts);
    expect(JSON.stringify(posted)).not.toContain(D2);
  });
});

describe("after a day has gone: hidden, never edited (Oliver's correction, 17 Nov)", () => {
  it("ticked private afterwards: the next automatic run marks its rows deleted (only deleted_at; the text stays in Oliver's database); never sent again", async () => {
    const { c, fake, jk } = await setUp();
    await press(fake, c);
    await saveSharePrivate(jk, D, "checkin", true);
    const n = fake.requests.length;
    await sendToTogether({ fetch: fake.fetch, now: c.now, mode: "hide" }); // the switch needn't be on to hide
    const patches = fake.requests.slice(n).filter((r) => r.method === "PATCH" && /esme-/.test(decodeURIComponent(r.url)));
    expect(patches.map((r) => Object.keys(JSON.parse(r.body)))).toEqual([["deleted_at"], ["deleted_at"]]);
    expect(fake.liveDays(SCHEDULE)).toEqual([]);
    expect(fake.dayRow(SCHEDULE, D)!.note).toBe(`Partly\n${NOTE_S}`); // hidden, not wiped: Together keeps it
    expect((await readSent(db))!.routine).toEqual({ [`schedule:${D}`]: "hidden", [`todos:${D}`]: "hidden" });
    // Un-ticked again: it stays hidden (never sent again).
    await saveSharePrivate(jk, D, "checkin", false);
    const m = dayPosts(fake).length;
    await press(fake, c);
    expect(dayPosts(fake).length).toBe(m);
    expect(fake.liveDays(SCHEDULE)).toEqual([]);
  });

  it("Stop with removing marks every sent daily-log day deleted too", async () => {
    const { stopTogether } = await import("./sender");
    const { c, fake } = await setUp();
    await press(fake, c);
    expect(await stopTogether({ fetch: fake.fetch, now: c.now }, { markDeleted: true })).toEqual({ kind: "ok" });
    expect(fake.liveDays(SCHEDULE)).toEqual([]);
    expect(fake.liveDays(TODOS)).toEqual([]);
  });

  it("a later edit here never changes the note there", async () => {
    const { c, fake, jk } = await setUp();
    await press(fake, c);
    const day = (await listDayLogs(jk, "2026-11-30"))[0]!;
    await saveDayLog(jk, DEVICE, { ...day.fields, todosNote: "Pretend after it went" }, { date: D, seen: day.seen, submittedAt: day.submittedAt });
    const rec = guardedFetch(fake.fetch, () => ["Pretend after it went"], c.now);
    await press(fake, c, rec.fetch);
    await sendToTogether({ fetch: rec.fetch, now: c.now, mode: "hide" });
    expect(rec.violations).toEqual([]);
    expect(fake.liveDays(TODOS)[0]!.note).toBe(`No\n${NOTE_T}`);
  });
});
