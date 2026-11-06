// TESTING (Life Planner - Together-link Testing Round 5, 2026-11-06): round 5's "Highlighted
// learnings" in the exercise note, the restore-safe learned/highlight writes after a backup
// Replace, and round 4's #53 (a cut-off Stop with removing pauses copying) and #54 (clean-up
// first, no journal key). Fake Together only, every word made up. Tests named "BUG:" fail on
// together-link @4df1240.

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
import { togetherId } from "./ids";
import { cancelStopRemoving, SIGN_IN_MESSAGES, sendToTogether, signInToTogether, stopTogether } from "./sender";
import { readAuth, readSent, TOGETHER_META, TOGETHER_SENT_META } from "./store";
import { clock, DEVICE, EMAIL, emptyDb, fakeTogether, guardedFetch, journalDay, PASSWORD, send, signedIn, type Clock } from "./testKit";

beforeEach(emptyDb);

const habit = (kind: "exercise" | "checkin") => togetherId("habit", kind, 1);
const isEventInsert = (method?: string, url?: string) => method === "POST" && String(url).includes("/rest/v1/todo_events");
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

/** Live exercise tallies' notes, by day. */
async function liveExerciseNotes(fake: FakeSupabase): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of fake.liveTallies(await habit("exercise"))) out[String(e.at).slice(0, 10)] = String(e.note ?? "");
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

  // Together v1 (Esme, 2026-11-06): highlights and "what I learned" are not sent; this checks how they
  // were sent, so it waits for the later update that brings them back (core-together, round 7).
  it.skip("only the right day's kept highlights and notes go, only after the day ends + 24 h; never a private day's, a removed one, another day's, today's, or any other journal words", async () => {
    const c = clock(`${D1}T09:00:00`);
    const fake = fakeTogether(c);
    // Words that may go so far (grows as days become due), and words that may never go.
    const never = [W.removed, W.removedNote, W.priv, W.privNote, W.today, W.todayNote, W.noExercise, W.noExerciseNote, W.morning, W.draft, W.thought, W.privLearned];
    let notYet = [W.keep, W.keepNote, W.later, W.laterNote, "Highlighted learnings"];
    const g = guardedFetch(fake.fetch, () => [...never, ...notYet], c.now);
    const r = await signInToTogether({ fetch: g.fetch, now: c.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD });
    expect(r).toEqual({ kind: "ok" });
    const { jk, set } = await journalDay(D1, { exercise: true });
    await journalDay(D2, { exercise: true, learned: W.privLearned });
    await journalDay(D3, { exercise: true });
    await journalDay(D4, { exercise: true });
    await hl(D1, W.keep, W.keepNote);
    const removed = await hl(D1, W.removed, W.removedNote);
    await removeHighlight(jk, DEVICE, await listed(jk, removed));
    await hl(D2, W.priv, W.privNote);
    await saveSharePrivate(jk, D2, "exercise", true);
    await hl(D3, W.later, W.laterNote);
    await hl(D4, W.today, W.todayNote);
    await hl("2026-11-05", W.noExercise, W.noExerciseNote); // a day with no card done
    // Every other journal part, with marker words.
    await finishMorningPage(jk, D1, DEVICE, W.morning);
    await saveMorningDraft(jk, D3, DEVICE, W.morning);
    await addMorningPhoto(jk, D1, { mime: "image/jpeg", data: btoa("pretend-jpeg-bytes"), width: 4, height: 3 });
    await saveExerciseDraft(jk, D1, DEVICE, cardRef(set.cards.find((k) => k.id === "b-002")!), W.draft);
    await saveNote(jk, D1, DEVICE, { prompt: null, thought: W.thought, steady: W.thought, memory: W.thought, skill: W.thought });

    const run = async (at: string) => {
      c.set(at);
      expect((await sendToTogether({ fetch: g.fetch, now: c.now })).kind).toBe("ok");
    };
    await run(`${D1}T23:00:00`); // D1 not ended
    await run(`${D2}T03:30:00`); // D1 ended: titles only
    await run(`${D3}T02:59:00`); // a minute before D1's answers are due
    expect(g.violations).toEqual([]);
    expect(g.seen.some((s) => s.body.includes(W.keep)), "nothing of a highlight yet").toBe(false);

    notYet = [W.later, W.laterNote]; // D1's answers are due at D3 03:00
    await run(`${D3}T03:30:00`);
    const notes1 = await liveExerciseNotes(fake);
    expect(notes1[D1]).toContain(`Highlighted learnings\n"${W.keep}"\n${W.keepNote}`);
    expect(notes1[D2], "a private day: titles only").not.toContain("Highlighted");
    expect(notes1[D3] ?? "").not.toContain("Highlighted");

    notYet = []; // D3's answers due at 2026-11-06 03:00
    await run(`${D4}T03:30:00`);
    await run(`${D4}T23:00:00`);
    const notes2 = await liveExerciseNotes(fake);
    expect(notes2[D3]).toContain(`Highlighted learnings\n"${W.later}"\n${W.laterNote}`);
    expect(notes2[D3]).not.toContain(W.keep);
    expect(notes2[D1]).not.toContain(W.later);
    expect(g.violations).toEqual([]);
  });

  // Together v1 (Esme, 2026-11-06): highlights and "what I learned" are not sent; this checks how they
  // were sent, so it waits for the later update that brings them back (core-together, round 7).
  it.skip("a highlight removed AFTER its day went: hidden in Together at the next run (the old tally deleted, the new one without it)", async () => {
    const D = "2026-11-04";
    const c = clock(`${D}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D, { exercise: true });
    const hid = await hl(D, "pretend Kestrelby path", "Pretend Kestrelby note");
    await hl(D, "pretend Larchmere gate");
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    expect((await liveExerciseNotes(fake))[D]).toContain("Kestrelby");
    await removeHighlight(jk, DEVICE, await listed(jk, hid));
    await send(fake, c);
    const live = fake.liveTallies(await habit("exercise"));
    expect(live).toHaveLength(1);
    expect(String(live[0]!.note)).not.toContain("Kestrelby");
    expect(String(live[0]!.note)).toContain("Larchmere");
    // Removing the last one: the heading goes too.
    const last = (await listHighlights(jk)).highlights[0]!;
    await removeHighlight(jk, DEVICE, last);
    await send(fake, c);
    expect((await liveExerciseNotes(fake))[D]).not.toMatch(/Larchmere|Highlighted learnings/);
    expect(fake.liveTallies(await habit("exercise"))).toHaveLength(1);
  });

  // Together v1 (Esme, 2026-11-06): highlights and "what I learned" are not sent; this checks how they
  // were sent, so it waits for the later update that brings them back (core-together, round 7).
  it.skip("ticked private AFTER its day went: the highlights are hidden at the next run (titles only live)", async () => {
    const D = "2026-11-04";
    const c = clock(`${D}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D, { exercise: true });
    await hl(D, "pretend Moorcastle bell", "Pretend Moorcastle note");
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    expect((await liveExerciseNotes(fake))[D]).toContain("Moorcastle");
    await saveSharePrivate(jk, D, "exercise", true);
    await send(fake, c);
    const live = fake.liveTallies(await habit("exercise"));
    expect(live).toHaveLength(1);
    expect(String(live[0]!.note)).not.toMatch(/Moorcastle|Highlighted/);
  });

  // Together v1 (Esme, 2026-11-06): highlights and "what I learned" are not sent; this checks how they
  // were sent, so it waits for the later update that brings them back (core-together, round 7).
  it.skip("a note added later to a sent day's highlight is sent once (one new version), and a replay sends nothing", async () => {
    const D = "2026-11-04";
    const c = clock(`${D}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D, { exercise: true });
    const hid = await hl(D, "pretend Netherby wall");
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    await saveHighlightNote(jk, DEVICE, openNoteSession(await listed(jk, hid)), "Pretend Netherby later note");
    await send(fake, c);
    expect((await liveExerciseNotes(fake))[D]).toContain(`"pretend Netherby wall"\nPretend Netherby later note`);
    const n = fake.requests.length;
    await send(fake, c);
    expect(fake.requests.length).toBe(n);
    expect(fake.liveTallies(await habit("exercise"))).toHaveLength(1);
  });

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

  // Together v1 (Esme, 2026-11-06): highlights and "what I learned" are not sent; this checks how they
  // were sent, so it waits for the later update that brings them back (core-together, round 7).
  it.skip("learned words and highlights written after it (from a page still holding the former id) go under the current id, and to Together once", async () => {
    const { D, c, fake, jk, before, after } = await replaced();
    const lid = await saveLearned(jk, D, before, "Pretend Quarrydown learned, and more after the Replace");
    expect(lid.startsWith(`learned:${D}:${after}_`)).toBe(true);
    const hid = await hl(D, "pretend Ravensgill bridge", "Pretend Ravensgill note", before);
    const rows = (await db.journal.where("kind").equals("highlight").toArray()).filter((r) => r.id.startsWith(`${hid}_`));
    expect(rows.map((r) => r.id.split("_")[1])).toEqual([after]);
    const h = await listed(jk, hid);
    await saveHighlightNote(jk, before, openNoteSession(h), "Pretend Ravensgill note, changed");
    const rows2 = (await db.journal.where("kind").equals("highlight").toArray()).filter((r) => r.id.startsWith(`${hid}_`));
    expect(rows2.every((r) => r.id.split("_")[1] === after)).toBe(true);
    const n = fake.requests.length;
    await send(fake, c);
    const inserts = fake.requests.slice(n).filter((r) => isEventInsert(r.method, r.url));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.body).toContain("and more after the Replace");
    expect(inserts[0]!.body).toContain("Pretend Ravensgill note, changed");
    expect(inserts[0]!.body).toContain("Pretend Quarrydown note");
    const m = fake.requests.length;
    await send(fake, c);
    expect(fake.requests.length).toBe(m);
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

/** Everything of hers live in Together: tallies (by day and kind), and habits not deleted. */
async function liveState(fake: FakeSupabase) {
  const tallies: string[] = [];
  for (const kind of ["exercise", "checkin"] as const) for (const e of fake.liveTallies(await habit(kind))) tallies.push(`${kind}:${String(e.at).slice(0, 10)}`);
  const habits: string[] = [];
  for (const kind of ["exercise", "checkin"] as const) if (fake.todos.get(await habit(kind)) && !fake.todos.get(await habit(kind))!.deleted_at) habits.push(kind);
  return { tallies: tallies.sort(), habits: habits.sort() };
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
  // Stop with removing makes, for this set-up: tally deletes (4 live tallies), then per habit a
  // count PATCH and a delete PATCH. Cut off after 0..7 of them.
  for (let cut = 0; cut <= 7; cut++) {
    it(`cut off after ${cut} request(s): paused; runs (and a restart, a sync, Send now) only carry on removing; nothing comes back; Finish removing ends it`, async () => {
      const { c, fake } = await answersLive();
      expect((await liveState(fake)).tallies, "set-up").toHaveLength(4);
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
      expect(later.filter((x) => x.body.includes('"deleted_at":null')), "no habit shown again while paused").toEqual([]);
      const state = await liveState(fake);
      expect(state.tallies.every((t) => afterStop.tallies.includes(t)), "nothing came back").toBe(true);
      expect(state, "the paused runs finished the removal").toEqual({ tallies: [], habits: [] });
      // Finish removing: done, forgotten, and nothing more goes after.
      expect(await stop(fake.fetch, c, true)).toEqual({ kind: "ok" });
      expect(await db.syncMeta.get(TOGETHER_SENT_META)).toBeUndefined();
      expect(await readAuth(db)).toBeUndefined();
      const n = fake.requests.length;
      expect((await send(fake, c)).kind).toBe("off");
      expect(fake.requests.length).toBe(n);
    });
  }

  it("Finish removing offline, then refused, then accepted: paused throughout, then everything removed", async () => {
    const { c, fake } = await answersLive();
    expect(await stop(dropsAfter(fake, 2), c, true)).toMatchObject({ kind: "error" });
    // Offline.
    expect(await stop(dropsAfter(fake, 0), c, true)).toEqual({ kind: "error", message: SIGN_IN_MESSAGES.offline });
    expect((await readSent(db))?.removing).toBe(true);
    // Refused (every tally delete).
    for (let i = 0; i < 4; i++) fake.inject({ status: 403, body: { code: "42501", message: "fake: refused" }, when: (q) => q.method === "PATCH" && q.url.includes("todo_events") });
    const refused = await stop(fake.fetch, c, true);
    expect(refused.kind).toBe("error");
    expect((await readSent(db))?.removing).toBe(true);
    expect(await readAuth(db)).toBeTruthy();
    // Between the tries, runs never put anything back.
    const n = fake.requests.length;
    await send(fake, c);
    expect(fake.requests.slice(n).filter((x) => (x.method === "POST" && x.url.includes("/rest/v1/")) || x.body.includes('"deleted_at":null'))).toEqual([]);
    expect(await stop(fake.fetch, c, true)).toEqual({ kind: "ok" });
    expect(await liveState(fake)).toEqual({ tallies: [], habits: [] });
  });

  it("two Stops in a row, both cut off: still paused; nothing comes back", async () => {
    const { c, fake } = await answersLive();
    expect((await stop(dropsAfter(fake, 1), c, true)).kind).toBe("error");
    expect((await stop(dropsAfter(fake, 1), c, true)).kind).toBe("error");
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

  for (const cut of [0, 2, 5]) {
    it(`Keep copying after a cut-off Stop (after ${cut}): only what's allowed goes again: never a private day's answers, one live tally per day, the counts right`, async () => {
      const { D, D2, c, fake } = await answersLive();
      expect((await stop(dropsAfter(fake, cut), c, true)).kind).toBe("error");
      await send(fake, c); // a paused run carries on removing
      await cancelStopRemoving();
      expect((await readSent(db))?.removing).toBeUndefined();
      const n = fake.requests.length;
      expect((await send(fake, c)).kind).toBe("ok");
      const sentAgain = fake.requests.slice(n);
      // The private day: titles only, ever.
      const d2Inserts = sentAgain.filter((x) => isEventInsert(x.method, x.url) && x.body.includes(`${D2}T12:00`));
      expect(d2Inserts.every((x) => !PRIVATE_WORDS.test(x.body))).toBe(true);
      const state = await liveState(fake);
      expect(state).toEqual({ tallies: [`checkin:${D2}`, `checkin:${D}`, `exercise:${D2}`, `exercise:${D}`].sort(), habits: ["checkin", "exercise"] });
      for (const kind of ["exercise", "checkin"] as const) expect(fake.todos.get(await habit(kind))!.tally).toBe(2);
      expect(Object.keys((await readSent(db))?.maybe ?? {})).toEqual([]);
      const m = fake.requests.length;
      await send(fake, c);
      expect(fake.requests.length, "a replay sends nothing").toBe(m);
    });
  }
});

// ================================================================ #54: clean-up first

describe("#54: a maybe-sent tally is cleaned up first, journal key or not", () => {
  async function maybeSent() {
    const D = "2026-11-04";
    const c = clock(`${D}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D, { checkin: true, exercise: true });
    c.set("2026-11-05T03:30:00");
    await send(fake, c);
    c.set("2026-11-06T03:30:00");
    fake.inject({ lostReply: true, when: (r) => isEventInsert(r.method, r.url) });
    expect((await send(fake, c)).kind).toBe("offline");
    expect(Object.keys((await readSent(db))?.maybe ?? {})).toHaveLength(1);
    return { D, c, fake, jk };
  }

  it("journal locked here (no key stored): deleted first, and only that one", async () => {
    const { c, fake, jk, D } = await maybeSent();
    await saveSharePrivate(jk, D, "exercise", true);
    await db.syncMeta.delete(JOURNAL_KEY_META);
    const before = await liveState(fake);
    expect((await send(fake, c)).kind).toBe("ok");
    expect((await readSent(db))?.maybe ?? {}).toEqual({});
    const after = await liveState(fake);
    expect(after.tallies.length).toBe(before.tallies.length - 1);
    expect(fake.requests.filter((r) => PRIVATE_WORDS.test(r.body) && isEventInsert(r.method, r.url)).length).toBeLessThanOrEqual(1); // only the cut-off one, never again
  });

  it("journal never set up on this device (no check row, no key): the clean-up still goes", async () => {
    const { c, fake } = await maybeSent();
    await db.syncMeta.delete(JOURNAL_KEY_META);
    await db.journal.clear();
    expect((await send(fake, c)).kind).toBe("ok");
    expect((await readSent(db))?.maybe ?? {}).toEqual({});
  });

  it("a live, non-private, recorded tally is never deleted by the clean-up, and runs don't flap (no delete/insert churn over many runs)", async () => {
    const { c, fake } = await maybeSent();
    expect((await send(fake, c)).kind).toBe("ok");
    const settled = await liveState(fake);
    expect(settled.tallies).toHaveLength(2);
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
    const live = fake.liveTallies(await habit("checkin"));
    expect(live).toHaveLength(1);
    expect(String(live[0]!.note)).toContain("Pretend check-in answer");
    expect(fake.todos.get(await habit("checkin"))!.tally).toBe(1);
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
      // Together v1 (Esme, 2026-11-06): highlights aren't sent; the set-up checks the answers went.
      expect((await liveExerciseNotes(fake))[D], "set-up: sent with the answers").toContain("Pretend exercise answer");
      await unreadableHighlight(where === "on the same day" ? D : "2026-11-02");
      await saveSharePrivate(jk, D, "exercise", true);
      await send(fake, c);
      await send(fake, c, true);
      expect((await liveExerciseNotes(fake))[D], "her answers and highlight stay readable in Together after she ticked the day private").not.toMatch(/Ulverby|Pretend exercise answer/);
    });
  }
});

void TOGETHER_META;
