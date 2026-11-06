// TESTING (Life Planner - Together-link Round 6 Testing, 2026-11-06): round 6's per-day
// highlights (#57) and incomplete / private days (#59), and the device-local record of whether a
// tally carries answers. Fake Together only, every word made up. Tests named "BUG:" fail on
// together-link @e473622.

import { db } from "../data/db";
import {
  createHighlight, listHighlights, openNoteSession, readLearned, removeHighlight, saveHighlightNote, saveLearned, saveSharePrivate,
} from "../data/repo";
import { describeAnchor } from "../journal/highlights";
import { journalAad, sealJson } from "../journal/crypto";
import type { FakeSupabase } from "./fakeSupabase";
import { togetherId } from "./ids";
import { signInToTogether, stopTogether } from "./sender";
import { readSent } from "./store";
import { clock, DEVICE, EMAIL, emptyDb, journalDay, PASSWORD, send, signedIn } from "./testKit";

beforeEach(emptyDb);

const habit = (kind: "exercise" | "checkin") => togetherId("habit", kind, 1);
const PHONE = "device-pretend-phone-02";
const CARD = { id: "b-001", track: "bpd", book: "Pretend first workbook", day: 1, chapter: 1, chapterTitle: "Pretend meadow", theme: "Pretend first-book one" };

async function key() {
  const { keyFor } = await import("../test/journalKey");
  return keyFor("fake-journal-together");
}

/** A highlight of `words` on `day` from `device` (the same words give the same place). */
async function hl(day: string, words: string, note = "", device = DEVICE) {
  const text = `A made-up learning text that says ${words} in the middle of it.`;
  const start = text.indexOf(words);
  const anchor = describeAnchor("learn", text, start, start + words.length)!;
  return createHighlight(await key(), day, device, CARD, anchor, note);
}

const listed = async (hid: string) => (await listHighlights(await key())).highlights.find((h) => h.hids.includes(hid))!;

async function liveNotes(fake: FakeSupabase, kind: "exercise" | "checkin" = "exercise"): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of fake.liveTallies(await habit(kind))) out[String(e.at).slice(0, 10)] = String(e.note ?? "");
  return out;
}

const bodiesWith = (fake: FakeSupabase, re: RegExp) => fake.requests.filter((r) => re.test(r.body)).map((r) => `${r.method} ${new URL(r.url).pathname}`);
const writes = (fake: FakeSupabase, from: number) => fake.requests.slice(from).filter((r) => r.method !== "GET" && r.url.includes("/rest/v1/")).map((r) => `${r.method} ${new URL(r.url).pathname} ${r.body.slice(0, 80)}`);

/** A row of `kind` on `day` that this device can't open (sealed with another journal's key: the WebKit case). */
async function unreadable(kind: "learned" | "highlight" | "answer", day: string, suffix: string) {
  const { keyFor } = await import("../test/journalKey");
  const other = await keyFor("fake-journal-some-other-key");
  const id = `${kind}:${day}:${suffix}`;
  await db.journal.put({ id, kind, date: day, fp: other.fp, ...(await sealJson(other.key, { v: 1, pretend: kind }, journalAad(id))) } as never);
  return id;
}

// ================================================================ #57 highlights per day

describe("#57: highlights merged across days and devices", () => {
  it("BUG: the same words highlighted on two days (two devices), shown as one; she writes a note on the day she then ticks private: it never goes under the other day", async () => {
    // The Mac highlights the words on D1, the phone the same words on D2, neither with a note;
    // after sync the app shows them as ONE highlight. On D2 (the day it is) she writes a note on
    // it, and ticks D2 private. The note box saves the note on both days' highlight ids (they
    // showed the same, empty, note), so it goes to Together with D1, at the next run.
    const D1 = "2026-11-03", D2 = "2026-11-04";
    const c = clock(`${D1}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D1, { exercise: true });
    await journalDay(D2, { exercise: true });
    const h1 = await hl(D1, "pretend Wrenhallow bridge");
    await hl(D2, "pretend Wrenhallow bridge", "", PHONE);
    expect((await listHighlights(jk)).highlights, "set-up: shown as one highlight").toHaveLength(1);
    c.set(`${D2}T20:00:00`);
    await saveHighlightNote(jk, DEVICE, openNoteSession(await listed(h1)), "Pretend Wrenhallow note, written on the private day");
    await saveSharePrivate(jk, D2, "exercise", true);
    for (const at of [`${D2}T23:00:00`, "2026-11-05T03:30:00", "2026-11-06T03:30:00", "2026-11-07T03:30:00"]) {
      c.set(at);
      await send(fake, c);
    }
    expect((await liveNotes(fake))[D1], "set-up: D1's answers went").toContain("Pretend exercise answer");
    expect(bodiesWith(fake, /Wrenhallow note/), "a note she wrote on the day she ticked private went to Together (under the other day)").toEqual([]);
  });

  // Together v1 (Esme, 2026-11-06): highlights and "what I learned" are not sent; this checks how they
  // were sent, so it waits for the later update that brings them back (core-together, round 7).
  it.skip("the same words on 3 days (3 notes, written apart), the middle day private: each day gets only its own note; the private day's never goes", async () => {
    const D1 = "2026-11-02", D2 = "2026-11-03", D3 = "2026-11-04";
    const c = clock(`${D1}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D1, { exercise: true });
    await journalDay(D2, { exercise: true });
    await journalDay(D3, { exercise: true });
    await hl(D1, "pretend Yarrowby steps", "Pretend Yarrowby first note");
    await hl(D2, "pretend Yarrowby steps", "Pretend Yarrowby private note", PHONE);
    await hl(D3, "pretend Yarrowby steps", "Pretend Yarrowby third note", "device-pretend-tablet-03");
    await saveSharePrivate(jk, D2, "exercise", true);
    expect((await listHighlights(jk)).highlights, "set-up: shown as one").toHaveLength(1);
    for (const at of ["2026-11-04T03:30:00", "2026-11-05T03:30:00", "2026-11-06T03:30:00", "2026-11-07T03:30:00"]) {
      c.set(at);
      await send(fake, c);
    }
    const notes = await liveNotes(fake);
    expect(notes[D1]).toContain('"pretend Yarrowby steps"\nPretend Yarrowby first note');
    expect(notes[D1]).not.toMatch(/third note|private note/);
    expect(notes[D3]).toContain('"pretend Yarrowby steps"\nPretend Yarrowby third note');
    expect(notes[D3]).not.toMatch(/first note|private note/);
    expect(notes[D2]).not.toMatch(/Yarrowby|Highlighted/);
    expect(bodiesWith(fake, /Yarrowby private note/)).toEqual([]);
  });

  // Together v1 (Esme, 2026-11-06): highlights and "what I learned" are not sent; this checks how they
  // were sent, so it waits for the later update that brings them back (core-together, round 7).
  it.skip("a highlight removed on the phone (its tombstone synced here) after the day went: hidden in Together at the next run; the other day's copy of the same words stays", async () => {
    const D1 = "2026-11-03", D2 = "2026-11-04";
    const c = clock(`${D1}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D1, { exercise: true });
    await journalDay(D2, { exercise: true });
    await hl(D1, "pretend Zennor cliff", "Pretend Zennor D1 note");
    const h2 = await hl(D2, "pretend Zennor cliff", "Pretend Zennor D2 note", PHONE);
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    expect((await liveNotes(fake))[D2]).toContain("Zennor D2 note");
    // The phone removes the highlight as it saw it there: only its own D2 id (written as the phone).
    const h = await listed(h2);
    await removeHighlight(jk, PHONE, { heads: h.heads.filter((x) => x.hid === h2) });
    await send(fake, c);
    const notes = await liveNotes(fake);
    expect(notes[D2]).not.toMatch(/Zennor|Highlighted/);
    expect(notes[D1]).toContain("Zennor D1 note");
    expect(fake.liveTallies(await habit("exercise"))).toHaveLength(2);
  });

  // Together v1 (Esme, 2026-11-06): highlights and "what I learned" are not sent; this checks how they
  // were sent, so it waits for the later update that brings them back (core-together, round 7).
  it.skip("removed on one device while the other changed its note (neither saw the other): Together shows what the app shows (kept, with the new note)", async () => {
    const D = "2026-11-04";
    const c = clock(`${D}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D, { exercise: true });
    const hid = await hl(D, "pretend Ashwater ford", "Pretend Ashwater first note");
    const seenByBoth = await listed(hid);
    await removeHighlight(jk, DEVICE, seenByBoth);
    await saveHighlightNote(jk, PHONE, openNoteSession(seenByBoth), "Pretend Ashwater phone note");
    const shown = await listed(hid);
    expect(shown?.note, "set-up: the app keeps it with the phone's note").toBe("Pretend Ashwater phone note");
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    const note = (await liveNotes(fake))[D]!;
    expect(note).toContain('"pretend Ashwater ford"\nPretend Ashwater phone note');
    expect(note).not.toContain("first note");
  });
});

// ================================================================ #59 incomplete and private days

describe("#59: incomplete, private and normal days together", () => {
  // Together v1 (Esme, 2026-11-06): highlights and "what I learned" are not sent; this checks how they
  // were sent, so it waits for the later update that brings them back (core-together, round 7).
  it.skip("mixed: D1 incomplete (a learned row won't open), D2 private, D3 normal: D1 never with answers, D2 titles only, D3 with answers; then 6 more runs change nothing", async () => {
    const D1 = "2026-11-02", D2 = "2026-11-03", D3 = "2026-11-04";
    const c = clock(`${D1}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D1, { exercise: true, checkin: true, learned: "Pretend Birchmoor learned" });
    await journalDay(D2, { exercise: true, checkin: true, learned: "Pretend Calderby learned" });
    await journalDay(D3, { exercise: true, checkin: true, learned: "Pretend Dovecote learned" });
    await unreadable("learned", D1, `${PHONE}_0a1b2c`);
    await unreadable("answer", D1, `0a1b2c3d4e5f:${PHONE}`);
    await saveSharePrivate(jk, D2, "exercise", true);
    await saveSharePrivate(jk, D2, "checkin", true);
    for (const at of ["2026-11-03T03:30:00", "2026-11-04T03:30:00", "2026-11-05T03:30:00", "2026-11-06T03:30:00"]) {
      c.set(at);
      await send(fake, c);
    }
    expect(bodiesWith(fake, /Birchmoor|Calderby/), "an incomplete or private day's words went").toEqual([]);
    const ex = await liveNotes(fake, "exercise");
    expect(ex[D3]).toContain("Pretend Dovecote learned");
    expect(ex[D2] ?? "").not.toMatch(/Pretend exercise answer|learned/);
    expect(ex[D1] ?? "").not.toMatch(/Pretend exercise answer|Birchmoor/);
    const ci = await liveNotes(fake, "checkin");
    expect(ci[D3]).toContain("Pretend check-in answer");
    expect(ci[D2] ?? "").not.toContain("Pretend check-in answer");
    const n = fake.requests.length;
    for (let i = 0; i < 6; i++) {
      c.advance(60 * 60 * 1000);
      await send(fake, c, i % 2 === 0);
    }
    expect(writes(fake, n), "runs flap (delete/insert churn)").toEqual([]);
    const rec = (await readSent(db))!;
    expect(rec.tallies[`exercise:${D3}`]).toMatchObject({ live: true, answers: true });
    expect(rec.tallies[`exercise:${D2}`]).toMatchObject({ live: true, answers: false });
    expect(rec.tallies[`checkin:${D2}`]).toMatchObject({ live: true, answers: false });
  });

  it("a sent day whose rows go unreadable / readable / unreadable while ticked private: hidden once, then never re-sent with answers; no churn", async () => {
    const D = "2026-11-04";
    const c = clock(`${D}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D, { exercise: true, learned: "Pretend Elmbridge learned" });
    await hl(D, "pretend Elmbridge spire", "Pretend Elmbridge note");
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    // Together v1 (Esme, 2026-11-06): highlights and learned words aren't sent; the set-up checks the answers went.
    expect((await liveNotes(fake))[D]).toContain("Pretend exercise answer");
    const bad = await unreadable("highlight", D, `0123456789abcdef_${PHONE}_0a1b2c3d`);
    await saveSharePrivate(jk, D, "exercise", true);
    await send(fake, c);
    expect((await liveNotes(fake))[D]).not.toMatch(/Elmbridge|Pretend exercise answer/);
    const n = fake.requests.length;
    const row = (await db.journal.get(bad))!;
    for (let i = 0; i < 4; i++) {
      if (i % 2 === 0) await db.journal.delete(bad);
      else await db.journal.put(row);
      await send(fake, c);
    }
    expect(writes(fake, n), "churn").toEqual([]);
    expect(bodiesWith(fake, /Pretend exercise answer/).length, "her words went once only (the first send)").toBe(1);
    expect(bodiesWith(fake, /Elmbridge/), "v1: learned words and highlights never go").toEqual([]);
    // Unticked again and readable: her answers go again (her choice).
    await db.journal.delete(bad);
    await saveSharePrivate(jk, D, "exercise", false);
    await send(fake, c);
    expect((await liveNotes(fake))[D]).toContain("Pretend exercise answer");
  });

  it("the record of what carries answers is kept over Stop without removing and signing in again; then a private tick still hides", async () => {
    const D1 = "2026-11-03", D2 = "2026-11-04";
    const c = clock(`${D1}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D1, { exercise: true });
    await journalDay(D2, { exercise: true });
    await saveSharePrivate(jk, D2, "exercise", true);
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    const before = (await readSent(db))!;
    expect(before.tallies[`exercise:${D1}`]).toMatchObject({ live: true, answers: true });
    expect(before.tallies[`exercise:${D2}`]).toMatchObject({ live: true, answers: false });
    expect((await stopTogether({ fetch: fake.fetch, now: c.now }, { markDeleted: false })).kind).toBe("ok");
    expect(await signInToTogether({ fetch: fake.fetch, now: c.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD })).toEqual({ kind: "ok" });
    const after = (await readSent(db))!;
    expect(after.tallies).toEqual(before.tallies);
    const n = fake.requests.length;
    await send(fake, c);
    expect(writes(fake, n), "nothing re-sent after signing in again").toEqual([]);
    await unreadable("learned", D1, `${PHONE}_0a1b2c`);
    await saveSharePrivate(jk, D1, "exercise", true);
    await send(fake, c);
    expect((await liveNotes(fake))[D1]).not.toContain("Pretend exercise answer");
    expect((await readSent(db))!.tallies[`exercise:${D1}`]).toMatchObject({ live: true, answers: false });
  });

  it("learned words she replaced before the day went are never sent (only the newest version goes)", async () => {
    const D = "2026-11-04";
    const c = clock(`${D}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D, { exercise: true, learned: "Pretend Fallowfield first words" });
    const day = await readLearned(jk, D);
    await saveLearned(jk, D, DEVICE, "Pretend Fallowfield second words", { seen: day.seen });
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    // Together v1 (Esme, 2026-11-06): "what I learned" never goes, neither version.
    expect((await liveNotes(fake))[D]).not.toContain("second words");
    expect(bodiesWith(fake, /Fallowfield first words/)).toEqual([]);
  });
});
