// TESTING (Life Planner - Together-link Testing Round 5, 2026-11-06): round 5's "Highlighted
// learnings" in the exercise note, the restore-safe learned/highlight writes after a backup
// Replace, and round 4's #53 (a cut-off Stop with removing pauses copying) and #54 (clean-up
// first, no journal key). Converted to the challenge model (2026-11-09): one challenge_days row per
// day, learned words and that day's highlights as research notes (the v1 hold lifted); a day that
// may be in Together (an insert whose reply was lost) is recorded with an unknown note and
// overwritten by the next run. Fake Together only, every word made up. Tests named "BUG:" failed on
// together-link @4df1240 (or, in the challenge model, on together-challenge @6ecc463).

import { db } from "../data/db";
import { exportBackup, restoreBackup } from "../data/backup";
import {
  addMorningPhoto, cardRef, createHighlight, finishMorningPage, listHighlights, openNoteSession, removeHighlight, saveExerciseDraft,
  saveHighlightNote, saveLearned, saveMorningDraft, saveNote, saveSharePrivate,
} from "../data/repo";
import { getDeviceId } from "../sync/engine";
import { describeAnchor } from "../journal/highlights";
import { JOURNAL_KEY_META } from "../journal/keyStore";
import type { FakeSupabase } from "./fakeSupabase";
import { cancelStopRemoving, SIGN_IN_MESSAGES, sendToTogether, signInToTogether, stopTogether } from "./sender";
import { readAuth, readSent, TOGETHER_META, TOGETHER_SENT_META } from "./store";
import { CHALLENGE, clock, DEVICE, EMAIL, emptyDb, fakeTogether, guardedFetch, journalDay, liveDays, liveNote, PASSWORD, send, signedIn, type Clock } from "./testKit";

beforeEach(emptyDb);

const isDayInsert = (method?: string, url?: string) => method === "POST" && String(url).includes("/rest/v1/challenge_days");
const PHONE = "device-pretend-phone-02";
const CARD = { id: "b-001", track: "bpd", book: "Pretend first workbook", day: 1, chapter: 1, chapterTitle: "Pretend meadow", theme: "Pretend first-book one" };

/** A highlight of `words` on `day` from `device` (the same words give the same place, so two devices' highlights of them are one). */
async function hl(day: string, words: string, note = "", device = DEVICE) {
  const { keyFor } = await import("../test/journalKey");
  const jk = await keyFor("fake-journal-together");
  const text = `A made-up learning text that says ${words} in the middle of it.`;
  const start = text.indexOf(words);
  const anchor = describeAnchor("learn", text, start, start + words.length)!;
  return createHighlight(jk, day, device, CARD, anchor, note);
}

async function listed(jk: Parameters<typeof listHighlights>[0], hid: string) {
  return (await listHighlights(jk)).highlights.find((h) => h.hids.includes(hid))!;
}

/** Live days' notes in her challenge, by day. */
async function liveExerciseNotes(fake: FakeSupabase): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const d of liveDays(fake)) out[String(d.day)] = String(d.note ?? "");
  return out;
}

// ================================================================ Highlighted learnings

describe("Highlighted learnings: a recorder over every request to the fake Together", () => {
  // Days: D1 an ordinary exercise day (a kept and a removed highlight), D2 ticked private, D3
  // an ordinary day due later, D4 the day it is when the last run goes (never ended).
  const D1 = "2026-11-02", D2 = "2026-11-03", D3 = "2026-11-04", D4 = "2026-11-06";
  const W = {
    keep: "pretend Amberwick clouds", keepNote: 'Pretend "Amberwick" note,\nline two',
    removed: "pretend Brackenlow hill", removedNote: "Pretend Brackenlow removed note",
    priv: "pretend Corriemoor river", privNote: "Pretend Corriemoor private note",
    later: "pretend Dunmarrow lake", laterNote: "Pretend Dunmarrow note",
    today: "pretend Eskerfell meadow", todayNote: "Pretend Eskerfell note",
    noExercise: "pretend Fenwhistle stones", noExerciseNote: "Pretend Fenwhistle note",
    morning: "Pretend Gorsehollow morning page", draft: "Pretend Hartswell draft", thought: "Pretend Ivyreach thought",
    privLearned: "Pretend Juniperdale learned on a private day",
  };

  it("BUG: the same words highlighted on two devices on two days, one day ticked private: that day's note never goes in the other day's Together note", async () => {
    // The Mac highlights the words on D1 (no note). The phone, not synced since, highlights the
    // same words on D2 and writes a note; D2 is ticked private. After a sync both are here, and
    // the app shows them as one highlight with the phone's note.
    const D1 = "2026-11-03", D2 = "2026-11-04";
    const c = clock(`${D1}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D1, { exercise: true });
    await journalDay(D2, { exercise: true });
    await hl(D1, "pretend Oakhurst window");
    await hl(D2, "pretend Oakhurst window", "Pretend Oakhurst private-day note", PHONE);
    await saveSharePrivate(jk, D2, "exercise", true);
    expect((await listHighlights(jk)).highlights, "set-up: shown as one highlight").toHaveLength(1);
    for (const at of ["2026-11-05T03:30:00", "2026-11-06T03:30:00", "2026-11-07T03:30:00"]) {
      c.set(at);
      await send(fake, c);
    }
    const leaked = fake.requests.filter((r) => r.body.includes("Oakhurst private-day note")).map((r) => `${r.method} ${new URL(r.url).pathname}`);
    expect(leaked, "words written on a private day went to Together (under the other day)").toEqual([]);
  });

  it("BUG: the same words highlighted on two days on two devices, the FIRST day ticked private: its note never goes under the later day", async () => {
    const D1 = "2026-11-03", D2 = "2026-11-04";
    const c = clock(`${D1}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D1, { exercise: true });
    await journalDay(D2, { exercise: true });
    await hl(D1, "pretend Pinemarsh door", "Pretend Pinemarsh private-day note");
    await saveSharePrivate(jk, D1, "exercise", true);
    await hl(D2, "pretend Pinemarsh door", "", PHONE);
    for (const at of ["2026-11-05T03:30:00", "2026-11-06T03:30:00"]) {
      c.set(at);
      await send(fake, c);
    }
    expect(fake.requests.filter((r) => r.body.includes("Pinemarsh private-day note")).length, "a private day's note went to Together").toBe(0);
  });
});

// ================================================================ after a backup Replace

describe("after a backup Replace (a new device id)", () => {
  async function replaced() {
    const D = "2026-11-04";
    const c = clock(`${D}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D, { exercise: true });
    const before = await getDeviceId(db);
    await saveLearned(jk, D, before, "Pretend Quarrydown learned");
    await hl(D, "pretend Quarrydown fence", "Pretend Quarrydown note", before);
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    const file = JSON.parse(JSON.stringify(await exportBackup(D)));
    await restoreBackup(file, "replace");
    const after = await getDeviceId(db);
    expect(after).not.toBe(before);
    return { D, c, fake, jk, before, after, file };
  }

  it("the same journal restored: nothing is sent again (no new insert, no delete)", async () => {
    const { c, fake } = await replaced();
    const n = fake.requests.length;
    expect((await send(fake, c)).kind).toBe("ok");
    expect(fake.requests.slice(n).filter((r) => r.method !== "GET")).toEqual([]);
  });

  it("BUG: \"Send now\" after a Replace, before sync is back on: a day she ticked private after the backup isn't sent", async () => {
    // A day whose answers aren't due yet when the backup is made; she ticks it private
    // afterwards (synced to her other devices). Then sync off, Replace with that backup: the
    // tick isn't in the file. Before turning sync on again (which would bring it back), she
    // presses Send now on the Sync page once the answers are due.
    const D = "2026-11-04";
    const c = clock(`${D}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D, { exercise: true, checkin: true });
    await hl(D, "pretend Saltcote harbour", "Pretend Saltcote note");
    c.set("2026-11-05T03:30:00");
    await send(fake, c); // titles only
    const file = JSON.parse(JSON.stringify(await exportBackup("2026-11-05")));
    await saveSharePrivate(jk, D, "exercise", true);
    await saveSharePrivate(jk, D, "checkin", true);
    await restoreBackup(file, "replace");
    c.set("2026-11-06T03:30:00");
    await send(fake, c, true); // Send now
    const leaked = fake.requests.filter((r) => /Saltcote|Pretend exercise answer|Pretend check-in answer/.test(r.body)).map((r) => `${r.method} ${new URL(r.url).pathname}`);
    expect(leaked, "answers of a day she had ticked private went to Together").toEqual([]);
  });
});

// ================================================================ #53: Stop with removing, cut off

/** Signed in; D's exercise and check-in answers (and a private D2's titles) live in Together. */
async function answersLive() {
  const D = "2026-11-04", D2 = "2026-11-03";
  const c = clock(`${D2}T09:00:00`);
  const fake = await signedIn(c);
  const { jk } = await journalDay(D2, { exercise: true, checkin: true });
  await journalDay(D, { exercise: true, checkin: true });
  await hl(D, "pretend Tidewell lantern", "Pretend Tidewell note");
  await saveSharePrivate(jk, D2, "exercise", true);
  await saveSharePrivate(jk, D2, "checkin", true);
  c.set("2026-11-06T03:30:00");
  expect((await send(fake, c)).kind).toBe("ok");
  return { D, D2, c, fake, jk };
}

/** Everything of hers live in Together: the days of her challenge not deleted, and any to-do (never made). */
async function liveState(fake: FakeSupabase) {
  const days = liveDays(fake).map((d) => String(d.day)).sort();
  return { days, todos: fake.todos.size + fake.events.size, challengeDeleted: !!fake.challenges.get(CHALLENGE)!.deleted_at };
}

const PRIVATE_WORDS = /Pretend exercise answer|Pretend check-in answer|Tidewell/;

/** A fetch whose /rest requests fail after the first `n` (the connection drops part-way). */
function dropsAfter(fake: FakeSupabase, n: number) {
  let k = 0;
  const st = { off: false };
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/rest/v1/") && (st.off || ++k > n)) {
      st.off = true;
      throw new TypeError("Failed to fetch");
    }
    return fake.fetch(input, init);
  }) as typeof fetch;
  return f;
}

const stop = (f: typeof fetch, c: Clock, markDeleted: boolean) => stopTogether({ fetch: f, now: c.now }, { markDeleted });

describe("#53: Stop with removing cut off at each step", () => {
  // Stop with removing makes, for this set-up: one delete PATCH per live day (2). Cut off after 0 or 1 of them.
  for (let cut = 0; cut <= 1; cut++) {
    it(`cut off after ${cut} request(s): paused; runs (and a restart, a sync, Send now) only carry on removing; nothing comes back; Finish removing ends it`, async () => {
      const { c, fake } = await answersLive();
      expect((await liveState(fake)).days, "set-up").toHaveLength(2);
      const r = await stop(dropsAfter(fake, cut), c, true);
      expect(r).toEqual({ kind: "error", message: SIGN_IN_MESSAGES.offline });
      expect((await readSent(db))?.removing, "paused, durably").toBe(true);
      const afterStop = await liveState(fake);
      // Runs: a sync's run, a restart (a fresh module state is the same record read again), Send now, a day later.
      const firstInsertAt = fake.requests.length;
      expect((await send(fake, c)).kind).toBe("ok");
      expect((await send(fake, c, true)).kind).toBe("ok");
      c.set("2026-11-08T03:30:00");
      await journalDay("2026-11-07", { exercise: true, checkin: true });
      expect((await send(fake, c)).kind).toBe("ok");
      const later = fake.requests.slice(firstInsertAt);
      expect(later.filter((x) => x.method === "POST" && x.url.includes("/rest/v1/")), "nothing inserted while paused").toEqual([]);
      expect(later.filter((x) => x.body.includes('"deleted_at":null')), "no day shown again while paused").toEqual([]);
      expect(later.filter((x) => x.body.includes('"note"')), "no note written while paused").toEqual([]);
      const state = await liveState(fake);
      expect(state.days.every((t) => afterStop.days.includes(t)), "nothing came back").toBe(true);
      expect(state, "the paused runs finished the removal").toEqual({ days: [], todos: 0, challengeDeleted: false });
      // Finish removing: done, forgotten, and nothing more goes after.
      expect(await stop(fake.fetch, c, true)).toEqual({ kind: "ok" });
      expect(Object.values((await readSent(db))!.days ?? {}).filter((d) => d.live)).toEqual([]); // kept, every day marked deleted (review I3)
      expect(await readAuth(db)).toBeUndefined();
      const n = fake.requests.length;
      expect((await send(fake, c)).kind).toBe("off");
      expect(fake.requests.length).toBe(n);
    });
  }

  it("Finish removing offline, then refused, then accepted: paused throughout, then everything removed", async () => {
    const { c, fake } = await answersLive();
    expect(await stop(dropsAfter(fake, 1), c, true)).toMatchObject({ kind: "error" });
    // Offline.
    expect(await stop(dropsAfter(fake, 0), c, true)).toEqual({ kind: "error", message: SIGN_IN_MESSAGES.offline });
    expect((await readSent(db))?.removing).toBe(true);
    // Refused (every day's delete).
    for (let i = 0; i < 2; i++) fake.inject({ status: 403, body: { code: "42501", message: "fake: refused" }, when: (q) => q.method === "PATCH" && q.url.includes("challenge_days") });
    const refused = await stop(fake.fetch, c, true);
    expect(refused.kind).toBe("error");
    expect((await readSent(db))?.removing).toBe(true);
    expect(await readAuth(db)).toBeTruthy();
    // Between the tries, runs never put anything back.
    const n = fake.requests.length;
    await send(fake, c);
    expect(fake.requests.slice(n).filter((x) => (x.method === "POST" && x.url.includes("/rest/v1/")) || x.body.includes('"deleted_at":null'))).toEqual([]);
    expect(await stop(fake.fetch, c, true)).toEqual({ kind: "ok" });
    expect(await liveState(fake)).toEqual({ days: [], todos: 0, challengeDeleted: false });
  });

  it("two Stops in a row, both cut off: still paused; nothing comes back", async () => {
    const { c, fake } = await answersLive();
    expect((await stop(dropsAfter(fake, 1), c, true)).kind).toBe("error");
    expect((await stop(dropsAfter(fake, 0), c, true)).kind).toBe("error");
    expect((await readSent(db))?.removing).toBe(true);
    const n = fake.requests.length;
    await send(fake, c);
    expect(fake.requests.slice(n).filter((x) => (x.method === "POST" && x.url.includes("/rest/v1/")) || x.body.includes('"deleted_at":null'))).toEqual([]);
  });

  it("paused, then Stop WITHOUT removing, then signing in again: still paused (nothing she asked to remove comes back)", async () => {
    const { c, fake } = await answersLive();
    expect((await stop(dropsAfter(fake, 1), c, true)).kind).toBe("error");
    expect(await stop(fake.fetch, c, false)).toEqual({ kind: "ok" });
    c.set("2026-11-09T10:00:00");
    expect(await signInToTogether({ fetch: fake.fetch, now: c.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD })).toEqual({ kind: "ok" });
    expect((await readSent(db))?.removing).toBe(true);
    const n = fake.requests.length;
    await send(fake, c);
    expect(fake.requests.slice(n).filter((x) => (x.method === "POST" && x.url.includes("/rest/v1/")) || x.body.includes('"deleted_at":null'))).toEqual([]);
  });

  it("paused because Together refused the token mid-Stop (she must sign in again): signing in again keeps it paused", async () => {
    const { c, fake } = await answersLive();
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();
    const r = await stop(fake.fetch, c, true);
    expect(r.kind).toBe("error");
    expect((await readSent(db))?.removing).toBe(true);
    expect(await signInToTogether({ fetch: fake.fetch, now: c.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD })).toEqual({ kind: "ok" });
    expect((await readSent(db))?.removing).toBe(true);
    const n = fake.requests.length;
    await send(fake, c);
    expect(fake.requests.slice(n).filter((x) => (x.method === "POST" && x.url.includes("/rest/v1/")) || x.body.includes('"deleted_at":null'))).toEqual([]);
  });

  for (const cut of [0, 1]) {
    it(`Keep copying after a cut-off Stop (after ${cut}): only what's allowed goes again: never a private day's answers, one row per day`, async () => {
      const { D, D2, c, fake } = await answersLive();
      expect((await stop(dropsAfter(fake, cut), c, true)).kind).toBe("error");
      await send(fake, c); // a paused run carries on removing
      await cancelStopRemoving();
      expect((await readSent(db))?.removing).toBeUndefined();
      const n = fake.requests.length;
      expect((await send(fake, c)).kind).toBe("ok");
      const sentAgain = fake.requests.slice(n);
      // The private day: titles only, ever.
      const d2Id = String(fake.dayRow(CHALLENGE, D2)!.id);
      const d2Writes = sentAgain.filter((x) => x.url.includes("challenge_days") && (x.url.includes(d2Id) || x.body.includes(`"day":"${D2}"`)));
      expect(d2Writes.every((x) => !PRIVATE_WORDS.test(x.body))).toBe(true);
      expect(liveNote(fake, D2)).not.toMatch(PRIVATE_WORDS);
      const state = await liveState(fake);
      expect(state).toEqual({ days: [D2, D], todos: 0, challengeDeleted: false });
      expect(fake.days.size, "one row per day").toBe(2);
      const m = fake.requests.length;
      await send(fake, c);
      expect(fake.requests.length, "a replay sends nothing").toBe(m);
    });
  }
});

// ================================================================ #54: clean-up first

describe("#54: a maybe-sent day is dealt with, journal key or not", () => {
  async function maybeSent() {
    const D = "2026-11-04";
    const c = clock(`${D}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D, { checkin: true, exercise: true });
    c.set("2026-11-06T03:30:00");
    fake.inject({ lostReply: true, when: (r) => isDayInsert(r.method, r.url) });
    expect((await send(fake, c)).kind).toBe("offline");
    expect((await readSent(db))?.days?.[D]).toMatchObject({ hash: "", live: true });
    return { D, c, fake, jk };
  }

  it("BUG: journal locked here (no key stored), the day ticked private on her phone: its answers aren't left live, and never inserted again", async () => {
    const { c, fake, jk, D } = await maybeSent();
    await saveSharePrivate(jk, D, "exercise", true);
    await db.syncMeta.delete(JOURNAL_KEY_META);
    expect((await send(fake, c)).kind).toBe("ok");
    expect(String(liveNote(fake, D) ?? ""), "her private answers are still live in Together").not.toContain("Pretend exercise answer");
    expect(fake.requests.filter((r) => PRIVATE_WORDS.test(r.body) && isDayInsert(r.method, r.url)).length).toBeLessThanOrEqual(1); // only the cut-off one, never again
  });

  it("a live, non-private day is never removed by the next run, and runs don't flap (no churn over many runs)", async () => {
    const { c, fake } = await maybeSent();
    expect((await send(fake, c)).kind).toBe("ok");
    const settled = await liveState(fake);
    expect(settled.days).toHaveLength(1);
    const n = fake.requests.length;
    for (let i = 0; i < 6; i++) await send(fake, c);
    expect(fake.requests.slice(n).filter((r) => r.method !== "GET"), "nothing more after it settled").toEqual([]);
    expect(await liveState(fake)).toEqual(settled);
  });

  it("the journal locked for several runs, then unlocked: the day is in Together exactly once with its answers", async () => {
    const { c, fake, jk } = await maybeSent();
    const stored = await db.syncMeta.get(JOURNAL_KEY_META);
    await db.syncMeta.delete(JOURNAL_KEY_META);
    for (let i = 0; i < 3; i++) await send(fake, c);
    await db.syncMeta.put(stored!);
    void jk;
    await send(fake, c);
    await send(fake, c);
    expect(fake.days.size).toBe(1);
    expect(liveDays(fake)).toHaveLength(1);
    expect(String(liveNote(fake, "2026-11-04"))).toContain("Pretend check-in answer");
  });
});

// ================================================================ a highlight row that won't open

describe("a highlight row this device can't open (sealed with another key)", () => {
  async function unreadableHighlight(day: string) {
    const { keyFor } = await import("../test/journalKey");
    const { journalAad, sealJson } = await import("../journal/crypto");
    const other = await keyFor("fake-journal-some-other-key");
    const id = `highlight:${day}:0123456789abcdef_${PHONE}_0a1b2c3d`;
    await db.journal.put({ id, kind: "highlight", date: day, fp: other.fp, ...(await sealJson(other.key, { v: 1, pretend: "highlight" }, journalAad(id))) });
  }

  for (const where of ["on another day", "on the same day"] as const) {
    it(`BUG: (${where}) a day already sent, then ticked private: still hidden in Together (titles only need no highlight)`, async () => {
      const D = "2026-11-04";
      const c = clock(`${D}T09:00:00`);
      const fake = await signedIn(c);
      const { jk } = await journalDay(D, { exercise: true });
      await hl(D, "pretend Ulverby tower", "Pretend Ulverby note");
      c.set("2026-11-06T03:30:00");
      await send(fake, c);
      expect((await liveExerciseNotes(fake))[D], "set-up: sent with the answers").toContain("Pretend exercise answer");
      expect((await liveExerciseNotes(fake))[D], "set-up: and the highlight").toContain("• pretend Ulverby tower — Pretend Ulverby note");
      await unreadableHighlight(where === "on the same day" ? D : "2026-11-02");
      await saveSharePrivate(jk, D, "exercise", true);
      await send(fake, c);
      await send(fake, c, true);
      expect((await liveExerciseNotes(fake))[D], "her answers and highlight stay readable in Together after she ticked the day private").not.toMatch(/Ulverby|Pretend exercise answer/);
    });
  }
});

void TOGETHER_META;
