// TESTING (Life Planner - Together Round 3 Testing, 2026-11-05): the round-3 fix for #49 (a tally
// that may be in Together is written down before it goes; every run deletes those first; Stop
// with removing deletes them, the live tallies and both habits before forgetting anything).
// Fake Together only, every value made up. Tests named "BUG:" fail on together-link @696dede.

import { db } from "../data/db";
import { saveSharePrivate } from "../data/repo";
import { JOURNAL_KEY_META } from "../journal/keyStore";
import type { FakeSupabase } from "./fakeSupabase";
import { togetherId } from "./ids";
import { notRemoved, SIGN_IN_MESSAGES, sendToTogether, signInToTogether, stopTogether } from "./sender";
import { readAuth, readSent, TOGETHER_META, TOGETHER_SENT_META } from "./store";
import { clock, EMAIL, emptyDb, journalDay, PASSWORD, send, signedIn, type Clock } from "./testKit";

const DAY = "2026-11-04";
const SIGN_IN = `${DAY}T10:00:00`;
const TITLES_AT = "2026-11-05T03:30:00";
const ANSWERS_AT = "2026-11-06T03:30:00";
const ANSWER = "Pretend check-in answer"; // journalDay's made-up check-in words
const EX_ANSWER = "Pretend exercise answer"; // journalDay's made-up exercise words

beforeEach(emptyDb);

const habit = (kind: "exercise" | "checkin") => togetherId("habit", kind, 1);
const isEventInsert = (method?: string, url?: string) => method === "POST" && String(url).includes("/rest/v1/todo_events");

/** Every tally in Together that isn't deleted and holds any of her answers (either habit). */
async function liveAnswers(fake: FakeSupabase) {
  const all = [...fake.liveTallies(await habit("checkin")), ...fake.liveTallies(await habit("exercise"))];
  return all.filter((e) => String(e.note ?? "").includes(ANSWER) || String(e.note ?? "").includes(EX_ANSWER));
}
const liveCount = async (fake: FakeSupabase) => fake.liveTallies(await habit("checkin")).length + fake.liveTallies(await habit("exercise")).length;
const habitsDeleted = async (fake: FakeSupabase) => ({
  exercise: !!fake.todos.get(await habit("exercise"))?.deleted_at,
  checkin: !!fake.todos.get(await habit("checkin"))?.deleted_at,
});
const stop = (f: typeof fetch, c: Clock, markDeleted: boolean) => stopTogether({ fetch: f, now: c.now }, { markDeleted });
const signInAgain = (fake: FakeSupabase, c: Clock) =>
  signInToTogether({ fetch: fake.fetch, now: c.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD });

/** Signed in, DAY's exercise and check-in done, and their titles-only tallies in Together. */
async function titlesSent(opts: { exercise?: boolean } = {}) {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { checkin: true, exercise: opts.exercise ?? false });
  c.set(TITLES_AT);
  expect((await send(fake, c)).kind).toBe("ok");
  expect(await liveAnswers(fake)).toHaveLength(0);
  c.set(ANSWERS_AT);
  return { c, fake, jk };
}

/** Like titlesSent, then the answers insert reaches Together but its reply is lost. */
async function answersMaybeSent() {
  const t = await titlesSent();
  t.fake.inject({ lostReply: true, when: (r) => isEventInsert(r.method, r.url) });
  expect((await send(t.fake, t.c)).kind).toBe("offline");
  expect(await liveAnswers(t.fake), "set-up: the answers are in Together").toHaveLength(1);
  expect(Object.keys((await readSent(db))?.maybe ?? {}), "set-up: written down as maybe-sent").toHaveLength(1);
  return t;
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
  it("during a hung answers insert (done in Together): nothing of hers is left live, both habits deleted, record forgotten", async () => {
    const { c, fake } = await titlesSent({ exercise: true });
    const h = hangOn(fake, isEventInsert, { applied: true });
    const run = sendToTogether({ fetch: h.fetch, now: c.now });
    await h.out;
    expect(await stop(h.fetch, c, true)).toEqual({ kind: "ok" });
    expect((await run).kind).toBe("offline");
    expect(await liveCount(fake), "a tally is still live in Together").toBe(0);
    expect(await habitsDeleted(fake)).toEqual({ exercise: true, checkin: true });
    expect(await readSent(db), "the record is forgotten only after Together confirmed").toBeUndefined();
    expect(await readAuth(db)).toBeUndefined();
  });

  it("during a hung delete of a maybe-sent tally (the next run's clean-up): nothing of hers is left live", async () => {
    const { c, fake } = await answersMaybeSent();
    const maybeId = Object.keys((await readSent(db))!.maybe!)[0]!;
    const h = hangOn(fake, (m, u) => m === "PATCH" && u.includes(maybeId), { applied: false });
    const run = sendToTogether({ fetch: h.fetch, now: c.now });
    await h.out;
    expect(await stop(h.fetch, c, true)).toEqual({ kind: "ok" });
    expect((await run).kind).toBe("offline");
    expect(await liveAnswers(fake)).toHaveLength(0);
    expect(await liveCount(fake)).toBe(0);
    expect(await habitsDeleted(fake)).toEqual({ exercise: true, checkin: true });
    expect(fake.todos.size, "no habit made by Stop").toBe(2);
  });

  it("during a hung habit insert (done in Together, never recorded): Stop deletes that habit too", async () => {
    const c = clock(SIGN_IN);
    const fake = await signedIn(c);
    await journalDay(DAY, { checkin: true });
    c.set(TITLES_AT);
    const h = hangOn(fake, (m, u) => m === "POST" && u.includes("/rest/v1/todos"), { applied: true });
    const run = sendToTogether({ fetch: h.fetch, now: c.now });
    await h.out;
    expect(await stop(h.fetch, c, true)).toEqual({ kind: "ok" });
    await run;
    const made = [...fake.todos.values()];
    expect(made.length, "set-up: the habit is in Together").toBe(1);
    expect(made.every((t) => !!t.deleted_at)).toBe(true);
  });
});

// ---- signing in again ---------------------------------------------------------------------------

describe("after Stop", () => {
  it("lost reply, Stop with removing, sign in again weeks later: no old answers come back, one habit per kind, only new days go", async () => {
    const { c, fake } = await answersMaybeSent();
    expect(await stop(fake.fetch, c, true)).toEqual({ kind: "ok" });
    c.set("2026-11-25T10:00:00");
    expect(await signInAgain(fake, c)).toEqual({ kind: "ok" });
    expect((await send(fake, c)).kind).toBe("ok");
    expect(await liveCount(fake), "nothing old comes back").toBe(0);
    // A new day, sent normally.
    await journalDay("2026-11-25", { checkin: true });
    c.set("2026-11-27T03:30:00");
    expect((await send(fake, c)).kind).toBe("ok");
    expect([...fake.todos.keys()].sort(), "no duplicate habits: the two fixed ids only").toEqual([await habit("checkin"), await habit("exercise")].sort());
    expect(fake.todos.get(await habit("checkin"))!.deleted_at).toBeFalsy();
    const live = fake.liveTallies(await habit("checkin"));
    expect(live.map((e) => String(e.at).slice(0, 10))).toEqual(["2026-11-25"]);
    expect(fake.todos.get(await habit("checkin"))!.tally).toBe(1);
  });

  it("Stop WITHOUT removing during a hung answers insert, then sign in again: the record is kept, the maybe-sent tally goes first, the day is in Together exactly once", async () => {
    const { c, fake } = await titlesSent();
    const h = hangOn(fake, isEventInsert, { applied: true });
    const run = sendToTogether({ fetch: h.fetch, now: c.now });
    await h.out;
    expect(await stop(h.fetch, c, false)).toEqual({ kind: "ok" });
    await run;
    expect(Object.keys((await readSent(db))?.maybe ?? {}), "kept for the next sign-in").toHaveLength(1);
    c.set("2026-11-10T10:00:00");
    expect(await signInAgain(fake, c)).toEqual({ kind: "ok" });
    const before = fake.requests.length;
    expect((await send(fake, c)).kind).toBe("ok");
    const inserts = fake.requests.slice(before).filter((r) => isEventInsert(r.method, r.url) && r.status === 201);
    expect(inserts, "the day's answers went in once").toHaveLength(1);
    expect(fake.liveTallies(await habit("checkin"))).toHaveLength(1);
    expect(await liveAnswers(fake)).toHaveLength(1);
    expect((await readSent(db))?.maybe ?? {}).toEqual({});
    // And a second run sends nothing more.
    const n = fake.requests.length;
    expect((await send(fake, c)).kind).toBe("ok");
    expect(fake.requests.slice(n).filter((r) => r.method === "POST")).toHaveLength(0);
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
    expect(Object.keys((await readSent(db))?.maybe ?? {})).toHaveLength(1);
    g.offline = false;
    expect(await stop(g.fetch, c, true)).toEqual({ kind: "ok" });
    expect(await liveCount(fake)).toBe(0);
    expect((await habitsDeleted(fake)).checkin).toBe(true);
    expect(await db.syncMeta.get(TOGETHER_SENT_META)).toBeUndefined();
    expect(await db.syncMeta.get(TOGETHER_META)).toBeUndefined();
  });

  it("Together refuses the maybe-sent delete once: she's told \"1 thing\", nothing forgotten; the next try works", async () => {
    const { c, fake } = await answersMaybeSent();
    const maybeId = Object.keys((await readSent(db))!.maybe!)[0]!;
    fake.inject({ status: 403, body: { code: "42501", message: "fake: refused" }, when: (r) => r.method === "PATCH" && r.url.includes(maybeId) });
    expect(await stop(fake.fetch, c, true)).toEqual({ kind: "error", message: notRemoved(1) });
    expect(Object.keys((await readSent(db))?.maybe ?? {})).toEqual([maybeId]);
    expect(await readAuth(db)).toBeTruthy();
    expect(await stop(fake.fetch, c, true)).toEqual({ kind: "ok" });
    expect(await liveCount(fake)).toBe(0);
  });

  it("BUG: Stop with removing cut off part-way (offline): the next run, before she tries again, doesn't put back in Together what Stop already removed", async () => {
    const { c, fake } = await titlesSent({ exercise: true });
    expect((await send(fake, c)).kind).toBe("ok");
    expect(await liveAnswers(fake), "set-up: both days' answers in Together").toHaveLength(2);
    // The connection drops after Stop's first three requests (the tallies are deleted).
    const g = gate(fake);
    let n = 0;
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/rest/v1/") && ++n > 3) throw new TypeError("Failed to fetch");
      return g.fetch(input, init);
    }) as typeof fetch;
    expect(await stop(flaky, c, true)).toEqual({ kind: "error", message: SIGN_IN_MESSAGES.offline });
    expect(await liveAnswers(fake), "set-up: Stop removed the answers before it was cut off").toHaveLength(0);
    // Back online, a sync finishes and the Together run goes (she hasn't pressed Stop again yet).
    expect((await send(fake, c)).kind).toBe("ok");
    expect({
      answersBackInTogether: (await liveAnswers(fake)).length,
      habitsShownAgain: Object.values(await habitsDeleted(fake)).filter((d) => !d).length,
    }).toEqual({ answersBackInTogether: 0, habitsShownAgain: 0 });
  });
});

// ---- a refused clean-up -------------------------------------------------------------------------

describe("a maybe-sent tally whose clean-up Together refuses", () => {
  it("blocks new sends while refused (she sees it as a day not hidden), and the next run once accepted clears it and sends the rest, no Send now needed", async () => {
    const { c, fake } = await answersMaybeSent();
    const maybeId = Object.keys((await readSent(db))!.maybe!)[0]!;
    const refuse = () => fake.inject({ status: 400, body: { code: "23514", message: "fake: refused" }, when: (r) => r.method === "PATCH" && r.url.includes(maybeId) });
    // A new day is due meanwhile.
    await journalDay("2026-11-05", { checkin: true });
    c.set("2026-11-06T04:00:00");
    for (let i = 0; i < 3; i++) {
      refuse();
      expect((await send(fake, c)).kind).toBe("ok");
      const sent = (await readSent(db))!;
      expect(sent.refused["maybe"], "she's told something couldn't be hidden").toMatchObject({ what: "hide" });
      expect(fake.liveTallies(await habit("checkin")).some((e) => String(e.at).startsWith("2026-11-05")), "nothing new went").toBe(false);
    }
    // Send now while still refused: same.
    refuse();
    expect((await send(fake, c, true)).kind).toBe("ok");
    expect((await readSent(db))!.refused["maybe"]).toBeTruthy();
    // Together accepts again: an ordinary run clears it and copies the new day.
    expect((await send(fake, c)).kind).toBe("ok");
    const sent = (await readSent(db))!;
    expect(sent.refused["maybe"]).toBeUndefined();
    expect(sent.maybe ?? {}).toEqual({});
    expect(fake.liveTallies(await habit("checkin")).map((e) => String(e.at).slice(0, 10)).sort()).toEqual([DAY, "2026-11-05"]);
    expect(await liveAnswers(fake)).toHaveLength(1); // DAY's answers (due); 11-05's are still titles only
  });

  it("ticked private while its clean-up is refused: once accepted, the answers are deleted and never inserted again", async () => {
    const { c, fake, jk } = await answersMaybeSent();
    const maybeId = Object.keys((await readSent(db))!.maybe!)[0]!;
    await saveSharePrivate(jk, DAY, "checkin", true);
    fake.inject({ status: 400, body: { code: "23514", message: "fake: refused" }, when: (r) => r.method === "PATCH" && r.url.includes(maybeId) });
    expect((await send(fake, c)).kind).toBe("ok");
    const mark = fake.requests.length;
    expect((await send(fake, c)).kind).toBe("ok");
    expect(await liveAnswers(fake)).toHaveLength(0);
    expect(fake.liveTallies(await habit("checkin"))).toHaveLength(1);
    const answerInserts = fake.requests.slice(mark).filter((r) => isEventInsert(r.method, r.url) && r.body.includes(ANSWER));
    expect(answerInserts).toHaveLength(0);
  });

  it("while refused, Stop with removing says it couldn't remove it; Stop without removing still works at once", async () => {
    const { c, fake } = await answersMaybeSent();
    const maybeId = Object.keys((await readSent(db))!.maybe!)[0]!;
    fake.inject({ status: 400, body: { code: "23514", message: "fake: refused" }, when: (r) => r.method === "PATCH" && r.url.includes(maybeId) });
    expect(await stop(fake.fetch, c, true)).toEqual({ kind: "error", message: notRemoved(1) });
    expect(await stop(fake.fetch, c, false)).toEqual({ kind: "ok" });
    expect(Object.keys((await readSent(db))?.maybe ?? {})).toEqual([maybeId]);
  });
});

// ---- a run that can't read the journal -----------------------------------------------------------

describe("a run on a device whose journal key can't be read", () => {
  it("BUG: a maybe-sent tally (a day she then ticked private on her phone) is still deleted first: deleting needs no journal", async () => {
    const { c, fake, jk } = await answersMaybeSent();
    await saveSharePrivate(jk, DAY, "checkin", true); // arrives by sync from the phone
    await db.syncMeta.delete(JOURNAL_KEY_META); // e.g. a stored key that came back unreadable
    expect((await send(fake, c)).kind).toBe("ok");
    expect(await liveAnswers(fake), "her private answers are still live in Together").toHaveLength(0);
  });
});

// ---- two devices ---------------------------------------------------------------------------------

describe("two devices, each with its own device-only record (\"Sign in on one device only\")", () => {
  it("both signed in, both maybe-sent the same day: Stop with removing on one leaves the other's copy live (documents the limit)", async () => {
    // Device 1: the answers insert lands, reply lost.
    const { c, fake } = await answersMaybeSent();
    const dev1 = await db.syncMeta.bulkGet([TOGETHER_META, TOGETHER_SENT_META]);
    // Device 2: signed in too (fresh record), sends the same day (same fixed ids); reply lost too.
    await db.syncMeta.bulkDelete([TOGETHER_META, TOGETHER_SENT_META]);
    const c2 = clock("2026-11-01T10:00:00");
    expect(await signInToTogether({ fetch: fake.fetch, now: c2.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD })).toEqual({ kind: "ok" });
    c2.set(ANSWERS_AT);
    fake.inject({ lostReply: true, when: (r) => isEventInsert(r.method, r.url) && r.body.includes(ANSWER) });
    await send(fake, c2);
    expect((await send(fake, c2)).kind).toBe("ok");
    const dev2 = await db.syncMeta.bulkGet([TOGETHER_META, TOGETHER_SENT_META]);
    // Device 1 runs again (it never knew of device 2's copy).
    await db.syncMeta.bulkPut(dev1.filter((x) => !!x));
    expect((await send(fake, c)).kind).toBe("ok");
    const dev1b = await db.syncMeta.bulkGet([TOGETHER_META, TOGETHER_SENT_META]);
    // Stop with removing on device 2 only.
    await db.syncMeta.bulkPut(dev2.filter((x) => !!x));
    expect(await stop(fake.fetch, c2, true)).toEqual({ kind: "ok" });
    const leftAfterStop2 = (await liveAnswers(fake)).length;
    const habitDeletedByStop2 = (await habitsDeleted(fake)).checkin;
    // Device 1 runs on (still signed in), then she stops there too, with removing.
    await db.syncMeta.bulkPut(dev1b.filter((x) => !!x));
    expect((await send(fake, c)).kind).toBe("ok");
    const habitStillDeletedAfterDev1Run = (await habitsDeleted(fake)).checkin;
    expect(await stop(fake.fetch, c, true)).toEqual({ kind: "ok" });
    // Found 2026-11-05: device 1's copy stays live under a habit device 2 deleted; device 1 goes
    // on copying into that deleted habit (it never un-deletes it), until its own Stop.
    expect({ leftAfterStop2, habitDeletedByStop2, habitStillDeletedAfterDev1Run }).toEqual({ leftAfterStop2: 1, habitDeletedByStop2: true, habitStillDeletedAfterDev1Run: true });
    expect(await liveCount(fake), "after Stop with removing on both devices, nothing is live").toBe(0);
  });
});
