import { db } from "../data/db";
import { listDayLogs, saveDayLog, saveSharePrivate } from "../data/repo";
import { EMPTY_DAY_LOG, type DayLogFields } from "../journal/routine";
import { readSent } from "./store";
import { sendToTogether, ANSWERS_DELAY_MS } from "./sender";
import { isFinal, ROUTINE_CHALLENGES, routineDayPayloads, sendRoutineChallenges, type RoutineCtx } from "./routineChallenges";
import { clock, COUPLE, DEVICE, emptyDb, guardedFetch, journalDay, ME, signedIn, type Clock } from "./testKit";
import type { FakeSupabase } from "./fakeSupabase";

// The daily log's two Together challenges (Oliver's answer, 16 Nov 2026): challenge days are
// INSERT ONLY, so a day goes once, only when final (her day over at 3am, then a whole day more),
// only with Done, never on a private day, and never edited or hidden afterwards. Against the fake
// Together, which refuses any change to those days; every request recorded. Made-up words only.

const D = "2026-11-10"; // a Tuesday
const FINAL = "2026-11-12T03:30:00"; // her day ended 03:00 on the 11th; a whole day more has passed
const NOTE_S = "Pretend Fennick schedule note";
const NOTE_T = "Pretend Fennick to-do note";
const LOG: DayLogFields = { schedule: "partly", scheduleNote: NOTE_S, todos: "no", todosNote: NOTE_T };

beforeEach(emptyDb);

const SCHEDULE = ROUTINE_CHALLENGES.schedule.id;
const TODOS = ROUTINE_CHALLENGES.todos.id;
/** Every request touching the daily log's challenges or their days. */
const routineRequests = (fake: FakeSupabase) =>
  fake.requests.filter((r) => /esme-(daily-|schedule-|todos-)/.test(decodeURIComponent(r.url) + r.body) || (r.url.includes("/challenges") && r.method === "POST"));

async function setUp(opts: { log?: DayLogFields; done?: boolean; at?: string } = {}) {
  const c = clock(`${D}T09:00:00`);
  const fake = await signedIn(c);
  const { jk } = await journalDay(D, {});
  await saveDayLog(jk, DEVICE, opts.log ?? LOG, { date: D, seen: [], submittedAt: null }, opts.done ?? true);
  c.set(opts.at ?? FINAL);
  return { c, fake, jk };
}

const press = (fake: FakeSupabase, c: Clock, f: typeof fetch = fake.fetch, extra: object = {}) =>
  sendToTogether({ fetch: f, now: c.now, batchPauseMs: 0, routineChallenges: true, ...extra });

describe("the seam: a day's log as challenge days", () => {
  it("one per answered question: the answer first, her note on the next line; fixed ids", () => {
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

describe("Send now", () => {
  it("a final, done day: both challenges made once (not accepted), each answer inserted once; a replay sends nothing", async () => {
    const { c, fake } = await setUp();
    expect(await press(fake, c)).toMatchObject({ kind: "ok" });
    for (const [key, name] of [[SCHEDULE, "Stuck to daily schedule"], [TODOS, "Finished today's to-dos"]]) {
      expect(fake.challenges.get(key)).toMatchObject({ couple_id: COUPLE, name, start: D, accepted_at: null });
    }
    expect(fake.liveDays(SCHEDULE)).toEqual([expect.objectContaining({ id: `esme-schedule-${D}`, day: D, note: `Partly\n${NOTE_S}`, by: ME })]);
    expect(fake.liveDays(TODOS)).toEqual([expect.objectContaining({ id: `esme-todos-${D}`, note: `No\n${NOTE_T}` })]);
    expect((await readSent(db))!.routine).toEqual({ [`schedule:${D}`]: "sent", [`todos:${D}`]: "sent" });
    const n = routineRequests(fake).length;
    await press(fake, c);
    await press(fake, c, fake.fetch, { retryRefused: true });
    expect(routineRequests(fake).slice(n)).toEqual([]);
  });

  it("challenges already in Together are used as they are (never made again)", async () => {
    const { c, fake } = await setUp();
    fake.addChallenge({ id: SCHEDULE, couple_id: COUPLE, name: "Pretend renamed by Esme" });
    fake.addChallenge({ id: TODOS, couple_id: COUPLE, name: "Pretend other name" });
    await press(fake, c);
    expect(fake.requests.filter((r) => r.method === "POST" && r.url.includes("/rest/v1/challenges"))).toEqual([]);
    expect(fake.challenges.get(SCHEDULE)!.name).toBe("Pretend renamed by Esme");
    expect(fake.liveDays(SCHEDULE)).toHaveLength(1);
  });

  for (const at of [`${D}T22:00:00`, "2026-11-11T02:30:00", "2026-11-11T20:00:00", "2026-11-12T02:59:00"]) {
    it(`not final yet (${at}): nothing of the log goes, not even the challenges`, async () => {
      const { c, fake } = await setUp({ at });
      const rec = guardedFetch(fake.fetch, () => [NOTE_S, NOTE_T, "esme-"], c.now);
      await press(fake, c, rec.fetch);
      expect(rec.violations).toEqual([]);
      expect(routineRequests(fake)).toEqual([]);
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
    const rec = guardedFetch(fake.fetch, () => [NOTE_S, NOTE_T, "esme-"], c.now);
    await press(fake, c, rec.fetch);
    expect(rec.violations).toEqual([]);
  });

  it("a day with another device's answers still listed (not settled) waits", async () => {
    const { c, fake, jk } = await setUp();
    await saveDayLog(jk, "device-pretend-phone-1", { ...EMPTY_DAY_LOG, schedule: "yes" }, { date: D, seen: [], submittedAt: null }, true);
    await press(fake, c);
    expect(routineRequests(fake)).toEqual([]);
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
    expect(fake.requests.slice(n).filter((r) => r.method === "PATCH" && r.url.includes("challenge_days") && /esme-/.test(decodeURIComponent(r.url)))).toEqual([]);
    expect(fake.liveDays(TODOS)[0]!.note).toBe(`No\n${NOTE_T}`);
  });

  it("an insert whose reply was lost goes in once: the next press meets a conflict and counts it sent", async () => {
    const { c, fake } = await setUp();
    fake.inject({ lostReply: true, when: (r) => r.method === "POST" && r.body.includes(`esme-schedule-${D}`) });
    expect(await press(fake, c)).toMatchObject({ kind: "offline" });
    expect((await readSent(db))!.routine).toMatchObject({ [`schedule:${D}`]: "maybe" });
    await press(fake, c);
    expect(fake.dayRows(SCHEDULE)).toHaveLength(1);
    expect(fake.dayRows(TODOS)).toHaveLength(1);
    expect((await readSent(db))!.routine).toEqual({ [`schedule:${D}`]: "sent", [`todos:${D}`]: "sent" });
  });

  it("a day she already logged by hand in Together is left exactly as she wrote it", async () => {
    const { c, fake } = await setUp();
    fake.addChallenge({ id: SCHEDULE, couple_id: COUPLE, name: "Stuck to daily schedule" });
    fake.logByHand({ couple_id: COUPLE, challenge_id: SCHEDULE, day: D, note: "Pretend by hand", by: ME });
    await press(fake, c);
    expect(fake.dayRows(SCHEDULE).map((r) => r.note)).toEqual(["Pretend by hand"]);
    expect((await readSent(db))!.routine![`schedule:${D}`]).toBe("sent");
  });

  it("switched off: nothing of the log goes", async () => {
    const { c, fake } = await setUp();
    await press(fake, c, fake.fetch, { routineChallenges: false });
    expect(routineRequests(fake)).toEqual([]);
  });

  it("the automatic runs (hide) never send it", async () => {
    const { c, fake } = await setUp();
    await sendToTogether({ fetch: fake.fetch, now: c.now, mode: "hide", routineChallenges: true });
    expect(routineRequests(fake)).toEqual([]);
  });
});

it("held after a Replace (sync not caught up): the step sends nothing at all", async () => {
  const { jk } = await journalDay(D, {});
  await saveDayLog(jk, DEVICE, LOG, { date: D, seen: [], submittedAt: null }, true);
  const call = vi.fn();
  const ctx = {
    sent: { userId: ME, since: D, salt: "00", refused: {} }, auth: { coupleId: COUPLE }, jk, restoredUnpulled: true, writes: 0,
    now: () => new Date(FINAL).getTime(), save: async () => undefined, call,
  } as unknown as RoutineCtx;
  await sendRoutineChallenges(ctx, await listDayLogs(jk, "2026-11-30"), ANSWERS_DELAY_MS, { maxWrites: 50, between: async () => undefined });
  expect(call).not.toHaveBeenCalled();
});
