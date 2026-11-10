// TESTING (Life Planner - Together Round 3 Testing, 2026-11-05): the round-3 fix for #49 (a write
// that may be in Together is written down before it goes; Stop with removing removes it with
// everything else before forgetting anything). Converted to the challenge model (2026-11-09): one
// `challenge_days` row per day by a fixed id; a day that may be in Together (an insert whose
// reply was lost) is recorded with an unknown note and overwritten on the next run. Fake Together
// only, every value made up. Tests named "BUG:" failed on together-link @696dede, or (the
// challenge conversion's) on together-challenge @6ecc463.

import { db } from "../data/db";
import { saveSharePrivate } from "../data/repo";
import { JOURNAL_KEY_META } from "../journal/keyStore";
import type { FakeSupabase } from "./fakeSupabase";
import { notRemoved, SIGN_IN_MESSAGES, sendToTogether, signInToTogether, stopTogether } from "./sender";
import { readAuth, readSent, TOGETHER_META, TOGETHER_SENT_META } from "./store";
import { CHALLENGE, clock, dayRow, dayWrites, EMAIL, emptyDb, journalDay, liveDays, liveNote, PASSWORD, send, signedIn, type Clock } from "./testKit";

const DAY = "2026-11-04";
const EARLIER = "2026-11-03";
const SIGN_IN = `${DAY}T10:00:00`;
const TITLES_AT = "2026-11-05T03:30:00";
const ANSWERS_AT = "2026-11-06T03:30:00";
const ANSWER = "Pretend check-in answer"; // journalDay's made-up check-in words
const EX_ANSWER = "Pretend exercise answer"; // journalDay's made-up exercise words

beforeEach(emptyDb);

const isDayInsert = (method?: string, url?: string) => method === "POST" && String(url).includes("/rest/v1/challenge_days");
const isDayPatch = (method?: string, url?: string) => method === "PATCH" && String(url).includes("/rest/v1/challenge_days");

/** Every live row in Together that holds any of her answers. */
function liveAnswers(fake: FakeSupabase) {
  return liveDays(fake).filter((d) => String(d.note ?? "").includes(ANSWER) || String(d.note ?? "").includes(EX_ANSWER));
}
const liveCount = (fake: FakeSupabase) => liveDays(fake).length;
/** Nothing of the link's own beyond day rows: no to-do made, her challenge itself never deleted. */
const onlyDays = (fake: FakeSupabase) => ({ todos: fake.todos.size, events: fake.events.size, challengeDeleted: !!fake.challenges.get(CHALLENGE)!.deleted_at });
const stop = (f: typeof fetch, c: Clock, markDeleted: boolean) => stopTogether({ fetch: f, now: c.now }, { markDeleted });
const signInAgain = (fake: FakeSupabase, c: Clock) =>
  signInToTogether({ fetch: fake.fetch, now: c.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD });

/**
 * Signed in, DAY's check-in (and exercise) done, and its titles-only row in Together (a press
 * while ticked private: sending is manual, Esme 2026-11-09); then un-ticked, so the next press is
 * the answers write.
 */
async function titlesSent(opts: { exercise?: boolean } = {}) {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { checkin: true, exercise: opts.exercise ?? false });
  for (const p of ["exercise", "checkin"] as const) await saveSharePrivate(jk, DAY, p, true);
  c.set(TITLES_AT);
  expect((await send(fake, c)).kind).toBe("ok");
  expect(liveAnswers(fake)).toHaveLength(0);
  for (const p of ["exercise", "checkin"] as const) await saveSharePrivate(jk, DAY, p, false);
  c.set(ANSWERS_AT);
  return { c, fake, jk };
}

/** Signed in, DAY's check-in done; its first insert (with answers) reaches Together but the reply is lost. */
async function answersMaybeSent() {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { checkin: true });
  c.set(ANSWERS_AT);
  fake.inject({ lostReply: true, when: (r) => isDayInsert(r.method, r.url) });
  expect((await send(fake, c)).kind).toBe("offline");
  expect(liveAnswers(fake), "set-up: the answers are in Together").toHaveLength(1);
  expect((await readSent(db))?.days?.[DAY], "set-up: written down as maybe-sent").toMatchObject({ hash: "", live: true });
  return { c, fake, jk };
}

/** A fetch that hangs (until aborted) on the first request `when` matches, after doing it or not. */
function hangOn(fake: FakeSupabase, when: (method: string, url: string) => boolean, opts: { applied: boolean }) {
  let hung!: () => void;
  const out = new Promise<void>((r) => (hung = r));
  let armed = true;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (armed && when((init?.method ?? "GET").toUpperCase(), url)) {
      armed = false;
      if (opts.applied) await fake.fetch(input, init);
      hung();
      return new Promise<Response>((_, reject) => {
        const s = init?.signal;
        if (s?.aborted) reject(new DOMException("aborted", "AbortError"));
        s?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    return fake.fetch(input, init);
  }) as typeof fetch;
  return { fetch: f, out };
}

/** A fetch with an on/off switch for the connection. */
function gate(fake: FakeSupabase) {
  const g = {
    offline: false,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (g.offline) throw new TypeError("Failed to fetch");
      return fake.fetch(input, init);
    }) as typeof fetch,
  };
  return g;
}

// ---- Stop with removing while something hangs ---------------------------------------------------

describe("Stop with removing, while a request hangs", () => {
  it("during a hung answers write (done in Together): nothing of hers is left live, her challenge kept, the record kept with every day deleted", async () => {
    const { c, fake } = await titlesSent({ exercise: true });
    const h = hangOn(fake, isDayPatch, { applied: true });
    const run = sendToTogether({ fetch: h.fetch, now: c.now });
    await h.out;
    expect(await stop(h.fetch, c, true)).toEqual({ kind: "ok" });
    expect((await run).kind).toBe("offline");
    expect(liveCount(fake), "a day is still live in Together").toBe(0);
    expect(onlyDays(fake)).toEqual({ todos: 0, events: 0, challengeDeleted: false });
    expect(Object.values((await readSent(db))!.days ?? {}).filter((d) => d.live)).toEqual([]); // kept, every day marked deleted (review I3)
    expect(await readAuth(db)).toBeUndefined();
  });

  it("during the next run's hung overwrite of a maybe-sent day: nothing of hers is left live", async () => {
    const { c, fake } = await answersMaybeSent();
    const h = hangOn(fake, isDayPatch, { applied: false });
    const run = sendToTogether({ fetch: h.fetch, now: c.now });
    await h.out;
    expect(await stop(h.fetch, c, true)).toEqual({ kind: "ok" });
    expect((await run).kind).toBe("offline");
    expect(liveAnswers(fake)).toHaveLength(0);
    expect(liveCount(fake)).toBe(0);
    expect(onlyDays(fake)).toEqual({ todos: 0, events: 0, challengeDeleted: false });
  });

  it("during a hung first insert of a day (done in Together, never confirmed): Stop removes that day too", async () => {
    const c = clock(SIGN_IN);
    const fake = await signedIn(c);
    await journalDay(DAY, { checkin: true });
    c.set(TITLES_AT);
    const h = hangOn(fake, isDayInsert, { applied: true });
    const run = sendToTogether({ fetch: h.fetch, now: c.now });
    await h.out;
    expect(await stop(h.fetch, c, true)).toEqual({ kind: "ok" });
    await run;
    expect(fake.days.size, "set-up: the day is in Together").toBe(1);
    expect(dayRow(fake, DAY)!.deleted_at).toBeTruthy();
  });
});

// ---- signing in again ---------------------------------------------------------------------------

describe("after Stop", () => {
  it("lost reply, Stop with removing, sign in again weeks later: nothing goes until she presses Send now; then the same row comes back with her answers; one row a day", async () => {
    const { c, fake } = await answersMaybeSent();
    expect(await stop(fake.fetch, c, true)).toEqual({ kind: "ok" });
    expect(liveCount(fake)).toBe(0);
    c.set("2026-11-25T10:00:00");
    expect(await signInAgain(fake, c)).toEqual({ kind: "ok" });
    expect((await sendToTogether({ fetch: fake.fetch, now: c.now, mode: "hide" })).kind).toBe("ok"); // an automatic run
    expect(liveCount(fake), "nothing comes back without a press").toBe(0);
    expect((await send(fake, c)).kind).toBe("ok"); // Send now
    expect(liveCount(fake), "the day is logged again (backfill)").toBe(1);
    expect(liveAnswers(fake)).toHaveLength(1);
    // A new day, sent on the next press.
    await journalDay("2026-11-25", { checkin: true });
    c.set("2026-11-25T20:00:00");
    expect((await send(fake, c)).kind).toBe("ok");
    expect(fake.days.size, "one row per day: the same fixed id shown again, never a second").toBe(2);
    expect(liveDays(fake).map((d) => d.day)).toEqual([DAY, "2026-11-25"]);
    expect(liveNote(fake, "2026-11-25")).toContain(ANSWER);
    expect(onlyDays(fake)).toEqual({ todos: 0, events: 0, challengeDeleted: false });
  });

  it("Stop WITHOUT removing during a hung answers write, then sign in again: the record is kept, the day is in Together exactly once, with her answers on the next press", async () => {
    const { c, fake } = await titlesSent();
    const h = hangOn(fake, isDayPatch, { applied: true });
    const run = sendToTogether({ fetch: h.fetch, now: c.now });
    await h.out;
    expect(await stop(h.fetch, c, false)).toEqual({ kind: "ok" });
    await run;
    expect((await readSent(db))?.days?.[DAY], "kept for the next sign-in").toBeTruthy();
    c.set("2026-11-10T10:00:00");
    expect(await signInAgain(fake, c)).toEqual({ kind: "ok" });
    expect((await send(fake, c)).kind).toBe("ok");
    expect(fake.days.size).toBe(1);
    expect(liveAnswers(fake)).toHaveLength(1);
    // And a second run sends nothing more.
    const n = fake.requests.length;
    expect((await send(fake, c)).kind).toBe("ok");
    expect(fake.requests.slice(n).filter((r) => r.method !== "GET")).toHaveLength(0);
  });
});

// ---- Stop with removing that can't finish -------------------------------------------------------

describe("Stop with removing while offline, or refused", () => {
  it("offline: she's told, nothing is forgotten (sign-in, record, maybe-sent), and trying again online removes everything", async () => {
    const { c, fake } = await answersMaybeSent();
    const g = gate(fake);
    g.offline = true;
    expect(await stop(g.fetch, c, true)).toEqual({ kind: "error", message: SIGN_IN_MESSAGES.offline });
    expect(await readAuth(db)).toBeTruthy();
    expect((await readSent(db))?.days?.[DAY]).toMatchObject({ hash: "", live: true });
    g.offline = false;
    expect(await stop(g.fetch, c, true)).toEqual({ kind: "ok" });
    expect(liveCount(fake)).toBe(0);
    expect(Object.values((await readSent(db))!.days ?? {}).filter((d) => d.live)).toEqual([]); // kept, every day marked deleted (review I3)
    expect(await db.syncMeta.get(TOGETHER_META)).toBeUndefined();
  });

  it("Together refuses removing the maybe-sent day once: she's told \"1 thing\", nothing forgotten; the next try works", async () => {
    const { c, fake } = await answersMaybeSent();
    fake.inject({ status: 403, body: { code: "42501", message: "fake: refused" }, when: (r) => isDayPatch(r.method, r.url) });
    expect(await stop(fake.fetch, c, true)).toEqual({ kind: "error", message: notRemoved(1) });
    expect((await readSent(db))?.days?.[DAY]).toMatchObject({ live: true });
    expect(await readAuth(db)).toBeTruthy();
    expect(await stop(fake.fetch, c, true)).toEqual({ kind: "ok" });
    expect(liveCount(fake)).toBe(0);
  });

  it("Stop with removing cut off part-way (offline): the next run, before she tries again, doesn't put back in Together what Stop already removed", async () => {
    const c = clock(SIGN_IN);
    const fake = await signedIn(c);
    await journalDay(EARLIER, { checkin: true });
    await journalDay(DAY, { checkin: true, exercise: true });
    c.set(ANSWERS_AT);
    expect((await send(fake, c)).kind).toBe("ok");
    expect(liveAnswers(fake), "set-up: both days' answers in Together").toHaveLength(2);
    // The connection drops after Stop's first request (one day removed).
    const g = gate(fake);
    let n = 0;
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/rest/v1/") && ++n > 1) throw new TypeError("Failed to fetch");
      return g.fetch(input, init);
    }) as typeof fetch;
    expect(await stop(flaky, c, true)).toEqual({ kind: "error", message: SIGN_IN_MESSAGES.offline });
    expect(liveAnswers(fake), "set-up: Stop removed one day before it was cut off").toHaveLength(1);
    const removed = liveDays(fake).length === 1 ? [EARLIER, DAY].find((d) => !liveNote(fake, d))! : "";
    // Back online, a sync finishes and the Together run goes (she hasn't pressed Stop again yet).
    expect((await send(fake, c)).kind).toBe("ok");
    expect({ removedDayBack: !!liveNote(fake, removed), postsAfter: dayWrites(fake).filter((r) => r.method === "POST").length }).toEqual({
      removedDayBack: false, postsAfter: 2,
    });
  });
});

// ---- a refused overwrite ------------------------------------------------------------------------

describe("a maybe-sent day whose overwrite Together refuses", () => {
  it("is shown as not yet hidden; other days still go; Send now tries it again", async () => {
    const { c, fake } = await answersMaybeSent();
    fake.inject({ status: 400, body: { code: "23514", message: "fake: refused" }, when: (r) => isDayPatch(r.method, r.url) && r.url.includes(String(dayRow(fake, DAY)!.id)) });
    // A new day is due meanwhile.
    await journalDay("2026-11-05", { checkin: true });
    c.set("2026-11-06T04:00:00");
    expect((await send(fake, c)).kind).toBe("ok");
    expect((await readSent(db))!.refused[DAY], "she's told something couldn't be hidden").toMatchObject({ what: "hide" });
    expect(liveDays(fake).map((d) => d.day)).toEqual([DAY, "2026-11-05"]);
    expect(await send(fake, c, true)).toMatchObject({ kind: "ok", refused: 0 });
    expect((await readSent(db))!.days![DAY]!.hash).not.toBe("");
    expect(liveAnswers(fake).map((d) => d.day)).toEqual([DAY, "2026-11-05"]); // a press sends both with answers
  });

  it("BUG: ticked private while its overwrite is refused: once Together accepts, the next automatic run overwrites the answers (no Send now needed), never inserting them again", async () => {
    const { c, fake, jk } = await answersMaybeSent();
    await saveSharePrivate(jk, DAY, "checkin", true);
    fake.inject({ status: 400, body: { code: "23514", message: "fake: refused" }, when: (r) => isDayPatch(r.method, r.url) });
    const auto = () => sendToTogether({ fetch: fake.fetch, now: c.now, mode: "hide" });
    expect((await auto()).kind).toBe("ok");
    const mark = fake.requests.length;
    expect((await auto()).kind).toBe("ok");
    expect(liveAnswers(fake), "her private answers are still live in Together").toHaveLength(0);
    expect(liveCount(fake)).toBe(1);
    expect(fake.requests.slice(mark).filter((r) => isDayInsert(r.method, r.url) && r.body.includes(ANSWER))).toHaveLength(0);
  });

  it("while refused, Stop with removing says it couldn't remove it; Stop without removing still works at once", async () => {
    const { c, fake } = await answersMaybeSent();
    fake.inject({ status: 400, body: { code: "23514", message: "fake: refused" }, when: (r) => isDayPatch(r.method, r.url) });
    expect(await stop(fake.fetch, c, true)).toEqual({ kind: "error", message: notRemoved(1) });
    expect(await stop(fake.fetch, c, false)).toEqual({ kind: "ok" });
    expect((await readSent(db))?.days?.[DAY]).toMatchObject({ hash: "", live: true });
  });
});

// ---- a run that can't read the journal -----------------------------------------------------------

describe("a run on a device whose journal key can't be read", () => {
  it("BUG: a maybe-sent day (one she then ticked private on her phone) is still dealt with: removing it needs no journal", async () => {
    const { c, fake, jk } = await answersMaybeSent();
    await saveSharePrivate(jk, DAY, "checkin", true); // arrives by sync from the phone
    await db.syncMeta.delete(JOURNAL_KEY_META); // e.g. a stored key that came back unreadable
    expect((await sendToTogether({ fetch: fake.fetch, now: c.now, mode: "hide" })).kind).toBe("ok"); // an automatic run
    expect(liveAnswers(fake), "her private answers are still live in Together").toHaveLength(0);
  });
});

// ---- two devices ---------------------------------------------------------------------------------

describe("two devices, each with its own device-only record (\"Sign in on one device only\")", () => {
  it("both signed in, both sending the same day: one row (the same fixed id); Stop with removing on one removes it, and the other doesn't put it back unless the day changes (documents the limit)", async () => {
    // Device 1: the answers insert lands, reply lost.
    const { c, fake } = await answersMaybeSent();
    const dev1 = await db.syncMeta.bulkGet([TOGETHER_META, TOGETHER_SENT_META]);
    // Device 2: signed in too (fresh record), sends the same day: the insert clashes, the same row is overwritten.
    await db.syncMeta.bulkDelete([TOGETHER_META, TOGETHER_SENT_META]);
    const c2 = clock("2026-11-01T10:00:00");
    expect(await signInToTogether({ fetch: fake.fetch, now: c2.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD })).toEqual({ kind: "ok" });
    c2.set(ANSWERS_AT);
    expect((await send(fake, c2)).kind).toBe("ok");
    expect(fake.days.size, "one row for the day").toBe(1);
    const dev2 = await db.syncMeta.bulkGet([TOGETHER_META, TOGETHER_SENT_META]);
    // Device 1 runs again (it never knew of device 2's write).
    await db.syncMeta.bulkPut(dev1.filter((x) => !!x));
    expect((await send(fake, c)).kind).toBe("ok");
    expect(fake.days.size).toBe(1);
    const dev1b = await db.syncMeta.bulkGet([TOGETHER_META, TOGETHER_SENT_META]);
    // Stop with removing on device 2 only.
    await db.syncMeta.bulkPut(dev2.filter((x) => !!x));
    expect(await stop(fake.fetch, c2, true)).toEqual({ kind: "ok" });
    const leftAfterStop2 = liveAnswers(fake).length;
    // Device 1 runs on (still signed in, the day unchanged), then she stops there too, with removing.
    await db.syncMeta.bulkPut(dev1b.filter((x) => !!x));
    expect((await send(fake, c)).kind).toBe("ok");
    const backAfterDev1Run = liveCount(fake);
    expect(await stop(fake.fetch, c, true)).toEqual({ kind: "ok" });
    expect({ leftAfterStop2, backAfterDev1Run }).toEqual({ leftAfterStop2: 0, backAfterDev1Run: 0 });
    expect(liveCount(fake), "after Stop with removing on both devices, nothing is live").toBe(0);
    expect(fake.days.size).toBe(1);
  });
});
