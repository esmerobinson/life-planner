// TESTING (Life Planner - Together-link Round 6 Testing, 2026-11-06): round 6's per-day
// highlights (#57) and incomplete / private days (#59), and the device-local record of whether a
// day carries answers. Converted to the challenge model (2026-11-09): one challenge_days row per
// day; learned words and that day's highlights go as research notes (the v1 hold lifted). Fake
// Together only, every word made up. Tests named "BUG:" failed on together-link @e473622 (or, in
// the challenge model with highlights sent, on together-challenge @6ecc463).

import { db } from "../data/db";
import {
  createHighlight, listHighlights, openNoteSession, readLearned, removeHighlight, saveHighlightNote, saveLearned, saveSharePrivate,
} from "../data/repo";
import { describeAnchor } from "../journal/highlights";
import { journalAad, sealJson } from "../journal/crypto";
import type { FakeSupabase } from "./fakeSupabase";
import { signInToTogether, stopTogether } from "./sender";
import { readSent } from "./store";
import { clock, DEVICE, EMAIL, emptyDb, journalDay, liveDays, PASSWORD, send, signedIn } from "./testKit";

beforeEach(emptyDb);

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

/** Each live day's note in her challenge, by day. */
async function liveNotes(fake: FakeSupabase): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const d of liveDays(fake)) out[String(d.day)] = String(d.note ?? "");
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

});

// ================================================================ #59 incomplete and private days

describe("#59: incomplete, private and normal days together", () => {
  it("a sent day whose rows go unreadable / readable / unreadable while ticked private: hidden once, then never re-sent with answers; no churn", async () => {
    const D = "2026-11-04";
    const c = clock(`${D}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(D, { exercise: true, learned: "Pretend Elmbridge learned" });
    await hl(D, "pretend Elmbridge spire", "Pretend Elmbridge note");
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    expect((await liveNotes(fake))[D]).toContain("Pretend exercise answer");
    expect((await liveNotes(fake))[D]).toContain("• pretend Elmbridge spire — Pretend Elmbridge note");
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
    expect(bodiesWith(fake, /Elmbridge/).length, "learned words and highlights went once only (the first send)").toBe(1);
    expect(JSON.stringify([...fake.days.values()]), "overwritten in Together, not kept underneath").not.toMatch(/Elmbridge|Pretend exercise answer/);
    // Unticked again and readable: her answers go again (her choice).
    await db.journal.delete(bad);
    await saveSharePrivate(jk, D, "exercise", false);
    await send(fake, c);
    expect((await liveNotes(fake))[D]).toContain("Pretend exercise answer");
    expect((await liveNotes(fake))[D]).toContain("Pretend Elmbridge learned");
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
    expect(before.days![D1]).toMatchObject({ live: true, parts: { exercise: "answers" } });
    expect(before.days![D2]).toMatchObject({ live: true, parts: { exercise: "titles" } });
    expect((await stopTogether({ fetch: fake.fetch, now: c.now }, { markDeleted: false })).kind).toBe("ok");
    expect(await signInToTogether({ fetch: fake.fetch, now: c.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD })).toEqual({ kind: "ok" });
    const after = (await readSent(db))!;
    expect(after.days).toEqual(before.days);
    const n = fake.requests.length;
    await send(fake, c);
    expect(writes(fake, n), "nothing re-sent after signing in again").toEqual([]);
    await unreadable("learned", D1, `${PHONE}_0a1b2c`);
    await saveSharePrivate(jk, D1, "exercise", true);
    await send(fake, c);
    expect((await liveNotes(fake))[D1]).not.toContain("Pretend exercise answer");
    expect((await readSent(db))!.days![D1]).toMatchObject({ live: true, parts: { exercise: "titles" } });
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
    expect((await liveNotes(fake))[D]).toContain("• Pretend Fallowfield second words");
    expect(bodiesWith(fake, /Fallowfield first words/)).toEqual([]);
  });
});
