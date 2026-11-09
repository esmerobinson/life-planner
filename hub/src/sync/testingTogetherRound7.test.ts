// TESTING (Life Planner - Together Round 7 Testing, 2026-11-06), moved to the challenge model
// (Esme, 2026-11-09): each day is one row in her "Mental Health Work" challenge, its note holding
// the Mental health exercise and the Daily check-in (titles and questions at the 3am day change,
// answers 24 h after the day ends, titles only for a part ticked private). "What I learned today"
// and that day's highlights (with their notes) go as research-note bullets in the exercise part,
// with its answers (the v1 hold lifted, 2026-11-08): never on a private day, never another day's,
// never on a day with no card done. Also round 7's #64 / #65 (after a Replace a day already sent
// is only hidden; sync on: wait for the first pull; sync off: 24 h).
// The Mac is the app's own database; the phone a second database; a fake sync server and a fake
// Together only. Every word is a made-up marker. Tests named "BUG:" fail on together-link @c871add.

import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import { exportBackup, restoreBackup } from "../data/backup";
import {
  addMorningPhoto, cardRef, createHighlight, ensureCheckinSet, finishMorningPage, listHighlights, moveAnswerOn, openNoteSession,
  readLearned, removeHighlight, saveAnswer, saveExerciseDraft, saveExerciseEdit, saveHighlightNote, saveLearned, saveMorningDraft,
  saveNote, saveSharePrivate, submitExerciseEntry,
} from "../data/repo";
import { journalId } from "../data/validate";
import type { JournalRow } from "../domain/types";
import { describeAnchor } from "../journal/highlights";
import { journalAad, sealJson, type JournalKey } from "../journal/crypto";
import { PROMPTS } from "../journal/prompts";
import { confirmedDevice, keyFor } from "../test/journalKey";
import type { FakeSupabase } from "../together/fakeSupabase";
import { togetherId } from "../together/ids";
import { sendToTogether, signInToTogether, stopTogether } from "../together/sender";
import { readSent } from "../together/store";
import { CHALLENGE, clock, DEVICE, EMAIL, fakeTogether, guardedFetch, journalDay, liveDays, PASSWORD, send, signedIn } from "../together/testKit";
import { FakeSyncServer } from "./fakeServer";
import { getDeviceId, saveSyncSettings, stopSyncing, syncOnce } from "./engine";

const leak = vi.hoisted(() => ({ mode: "none" as "none" | "learned" | "highlight-note" }));

// Leak proofs only: a deliberately broken COPY of the sender's journal reader (in this file only,
// no app code changed) that adds EVERY day's learned words, or every highlight's note, to each
// exercise note (not just that day's own). The recorder must catch both.
vi.mock("../together/journalNotes", async (importOriginal) => {
  const real = await importOriginal<typeof import("../together/journalNotes")>();
  return {
    ...real,
    readJournalDays: async (...args: Parameters<typeof real.readJournalDays>) => {
      const days = await real.readJournalDays(...args);
      if (leak.mode === "none" || !days?.exercise) return days;
      const repo = await import("../data/repo");
      for (const [d, note] of days.exercise.notes) {
        const extra = leak.mode === "learned"
          ? (await repo.listLearned(args[0], "9999-12-31")).map((x) => x.text).join("\n")
          : (await repo.listHighlights(args[0])).highlights.map((h) => h.note).join("\n");
        if (extra) days.exercise.notes.set(d, { titles: note.titles, full: `${note.full}\n\n${extra}` });
      }
      return days;
    },
  };
});

const TOKEN = "7a77".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const PHONE = "device-pretend-phone-07";
const TITLE = "Pretend first workbook · Day 1 · Pretend first-book one";
const CARD = { id: "b-001", track: "bpd", book: "Pretend first workbook", day: 1, chapter: 1, chapterTitle: "Pretend meadow", theme: "Pretend first-book one" };
let t = 1_800_000_000_000;
let n = 0;
const open: HubDB[] = [];
let jk: JournalKey;

beforeAll(async () => {
  jk = await keyFor("fake-journal-together"); // the key testKit's journalDay uses
});
beforeEach(async () => {
  leak.mode = "none";
  t = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => (t += 1000));
  await Promise.all([db.items.clear(), db.goals.clear(), db.files.clear(), db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear()]);
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  await confirmedDevice(db, jk);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function phoneDevice() {
  const d = new HubDB(`together-r7-phone-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}
async function sealed(kind: JournalRow["kind"], date: string, suffix: string, entry: unknown): Promise<JournalRow> {
  const id = journalId(kind, date, suffix);
  return { id, kind, date, fp: jk.fp, ...(await sealJson(jk.key, entry, journalAad(id))) };
}
const phoneTick = (phone: HubDB, date: string, part: "exercise" | "checkin", on: boolean) =>
  sealed("share", date, part, { v: 1, private: on, at: Date.now() }).then((r) => phone.journal.put(r));
let lid = 0;
const phoneLearned = (phone: HubDB, date: string, text: string) =>
  sealed("learned", date, `${PHONE}_p${(++lid).toString(36)}`, { v: 1, text, at: Date.now() }).then((r) => phone.journal.put(r));

const ok = async (d: HubDB, s: FakeSyncServer) => expect((await syncOnce({ db: d, fetch: s.fetch })).kind).toBe("ok");
async function syncBoth(server: FakeSyncServer, phone: HubDB) {
  for (let i = 0; i < 2; i++) {
    await ok(db, server);
    await ok(phone, server);
  }
}
/** Her challenge's live days in Together, by date: the note (both parts in one row). */
async function liveNotes(fake: FakeSupabase): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const d of liveDays(fake)) out[String(d.day)] = String(d.note ?? "");
  return out;
}
const Q = `**${PROMPTS[0]!.text}**`;
/** A day's note as the sender builds it: each part titles only (true), with an answer (a string), or absent. */
function note(p: { ex?: true | string; research?: string[]; ci?: true | string }): string {
  const parts: string[] = [];
  if (p.ex !== undefined) {
    const blocks = [`Mental Health Exercise\n${TITLE}`];
    if (typeof p.ex === "string") {
      if (p.research?.length) blocks.push(["Research notes", ...p.research.map((b) => `• ${b}`)].join("\n"));
      blocks.push(p.ex);
    }
    parts.push(blocks.join("\n\n"));
  }
  if (p.ci !== undefined) parts.push(typeof p.ci === "string" ? `Check In\n${Q}\n${p.ci}` : `Check In\n${Q}`);
  return parts.join("\n\n");
}
const wire = (fake: FakeSupabase) => JSON.stringify(fake.requests);
/** Every write to Together since `from` (any table). */
const writes = (fake: FakeSupabase, from: number) =>
  fake.requests.slice(from).filter((r) => r.method !== "GET" && r.url.includes("/rest/v1/")).map((r) => `${r.method} ${new URL(r.url).pathname} ${r.body.slice(0, 100)}`);
const dayIdOf = (date: string) => togetherId("day", `${CHALLENGE}:${date}`, 1);
/** Every write of a day row since `from` with a note (an insert or an overwrite), with its date. */
async function noteWrites(fake: FakeSupabase, from = 0): Promise<{ day: string; note: string }[]> {
  const out: { day: string; note: string }[] = [];
  for (const r of fake.requests.slice(from)) {
    if (r.method === "GET" || !r.url.includes("/rest/v1/challenge_days")) continue;
    const body = JSON.parse(r.body) as { day?: string; note?: string };
    if (body.note === undefined) continue;
    const id = r.method === "POST" ? null : decodeURIComponent(new URL(r.url).searchParams.get("id")!.slice(3));
    const day = body.day ?? String([...fake.days.values()].find((d) => d.id === id)?.day ?? "?");
    out.push({ day, note: body.note });
  }
  return out;
}

/** A highlight of `words` on `day` written as `device`. */
async function hl(day: string, words: string, note = "", device = DEVICE) {
  const text = `A made-up learning text that says ${words} in the middle of it.`;
  const start = text.indexOf(words);
  const anchor = describeAnchor("learn", text, start, start + words.length)!;
  return createHighlight(jk, day, device, CARD, anchor, note);
}
const listed = async (hid: string) => (await listHighlights(jk)).highlights.find((h) => h.hids.includes(hid));

/** A day's exercise and/or check-in with that day's own answer words. */
async function day(date: string, name: string, opts: { exercise?: boolean; checkin?: boolean }) {
  const { set } = await journalDay(date, {});
  const card = set.cards.find((k) => k.id === "b-001")!;
  if (opts.exercise) await submitExerciseEntry(jk, date, DEVICE, cardRef(card), `Pretend ${name} exercise answer`);
  if (opts.checkin) {
    await ensureCheckinSet(jk, date, [PROMPTS[0]!.id, PROMPTS[1]!.id]);
    await saveAnswer(jk, date, PROMPTS[0]!.id, DEVICE, `Pretend ${name} check-in answer`, true);
    await moveAnswerOn(jk, date, PROMPTS[1]!.id, DEVICE, { skip: true });
  }
  return { set, card };
}
/** Answers due: 24 h after the day ended at 3am (local), i.e. 03:00 two days on. */
const dueAt = (date: string) => {
  const d = new Date(`${date}T03:00:00`);
  d.setDate(d.getDate() + 2);
  return d.getTime();
};

// ================================================================ the scope recorder

/** The whole scope run (see the test below), returning what the checks need. */
async function scopeRun() {
  const D1 = "2026-11-02", D2 = "2026-11-03", D3 = "2026-11-04", D4 = "2026-11-05", D5 = "2026-11-06", D6 = "2026-11-08";
  const NAME: Record<string, string> = { [D1]: "Amberlode", [D2]: "Brindlemoss", [D3]: "Cobblewick", [D4]: "Dapplecombe", [D5]: "Eldergrove", [D6]: "Fernhallow" };
  const c = clock(`${D1}T09:00:00`);
  const fake = fakeTogether(c);
  const server = new FakeSyncServer(TOKEN);
  const phone = await phoneDevice();
  // Never, in any request (address, headers, body, any string in it), on any day.
  const NEVER = [
    // what I learned: a replaced version, a version not shown, the phone's older words, a private day's, a check-in-only day's, a learned-only day's
    "Pretend Larkspur first learned", "Pretend Mistlethwaite learned", "Pretend Nettlecombe learned", "Pretend Orrisford phone learned",
    "Pretend Pellinore learned", "Pretend Quenby learned",
    // highlights and notes: removed, private day, the phone's note before it changed, check-in-only day, learned-only day
    "Saltmarsh", "Thistlebrook", "Pretend Umberlea phone note", "Vintondale", "Wolverleigh",
    // old headings
    "Highlighted learnings", "Highlighted", "What I learned",
    // every other journal part, to-dos
    "Pretend Zennorwick morning page", "Pretend Zennorwick morning draft", "Pretend Zennorwick hard thought", "Pretend Zennorwick steady",
    "Pretend Zennorwick draft answer", "Pretend Zennorwick to-do", "Pretend Zennorwick to-do notes", btoa("pretend-r7-jpeg-bytes"),
    // a private day's answers; the restored (older) answer she had replaced before it ever went
    "Pretend Brindlemoss exercise answer", "Pretend Brindlemoss check-in answer", "Pretend Cobblewick exercise answer",
    TOKEN, jk.fp,
  ];
  // That day's research notes: allowed only with that day's exercise answers.
  const RESEARCH: Record<string, string[]> = {
    [D1]: ["Pretend Larkspur learned, kept", "pretend Rainsworth arch", "Pretend Rainsworth note"],
    [D3]: ["Pretend Larkspur second learned", "pretend Umberlea weir", "Pretend Umberlea later note"],
    [D6]: ["pretend Yewbarrow cairn", "Pretend Yewbarrow note"],
  };
  const privateNow = new Set<string>([`exercise:${D2}`, `checkin:${D2}`]);
  let hold = false; // after the Replace, until the pull: no answers at all
  let signedInNow = false;
  const forbidden = () => {
    const out = [...NEVER, ...(signedInNow ? [PASSWORD] : [])];
    for (const [d, name] of Object.entries(NAME)) {
      for (const [kind, label] of [["exercise", "exercise"], ["checkin", "check-in"]] as const) {
        const words = d === D3 && kind === "exercise" ? [`Pretend ${name} edited exercise answer`] : [`Pretend ${name} ${label} answer`];
        if (kind === "exercise") words.push(...(RESEARCH[d] ?? []));
        if (hold || c.now() < dueAt(d) || privateNow.has(`${kind}:${d}`)) out.push(...words);
      }
    }
    return out;
  };
  const g = guardedFetch(fake.fetch, forbidden, c.now);
  const env = { fetch: g.fetch, now: c.now };
  const run = async (at: string, sendNow = false) => {
    c.set(at);
    expect((await sendToTogether({ ...env, retryRefused: sendNow })).kind, at).toBe("ok");
  };

  expect(await signInToTogether(env, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD })).toEqual({ kind: "ok" });
  signedInNow = true;

  // D1: exercise + check-in, learned (replaced once), a kept highlight with a note, a removed one, every other part.
  const { set } = await day(D1, NAME[D1]!, { exercise: true, checkin: true });
  await saveLearned(jk, D1, DEVICE, "Pretend Larkspur first learned");
  await saveLearned(jk, D1, DEVICE, "Pretend Larkspur learned, kept", { seen: (await readLearned(jk, D1)).seen });
  await hl(D1, "pretend Rainsworth arch", "Pretend Rainsworth note");
  const removed = await hl(D1, "pretend Saltmarsh quay", "Pretend Saltmarsh note");
  await removeHighlight(jk, DEVICE, (await listed(removed))!);
  await finishMorningPage(jk, D1, DEVICE, "Pretend Zennorwick morning page");
  await saveMorningDraft(jk, D1, DEVICE, "Pretend Zennorwick morning draft");
  await addMorningPhoto(jk, D1, { mime: "image/jpeg", data: btoa("pretend-r7-jpeg-bytes"), width: 4, height: 3 });
  await saveNote(jk, D1, DEVICE, { prompt: null, thought: "Pretend Zennorwick hard thought", steady: "Pretend Zennorwick steady", memory: "Pretend Zennorwick steady", skill: "Pretend Zennorwick steady" });
  await saveExerciseDraft(jk, D1, DEVICE, cardRef(set.cards.find((k) => k.id === "b-002")!), "Pretend Zennorwick draft answer");
  await db.items.put({ id: "pretend-r7-todo", kind: "task", title: "Pretend Zennorwick to-do", notes: "Pretend Zennorwick to-do notes", links: [], areaId: "mind", priority: 2, status: "done", completedAt: D1, createdAt: D1, touchedAt: D1 });
  await syncBoth(server, phone);
  await run(`${D1}T23:00:00`);
  await run(`${D2}T03:30:00`); // D1 titles

  // D2: ticked private (both), with learned words and a highlight note.
  c.set(`${D2}T10:00:00`);
  await day(D2, NAME[D2]!, { exercise: true, checkin: true });
  await saveSharePrivate(jk, D2, "exercise", true);
  await saveSharePrivate(jk, D2, "checkin", true);
  await saveLearned(jk, D2, DEVICE, "Pretend Mistlethwaite learned on a private day");
  await hl(D2, "pretend Thistlebrook bend", "Pretend Thistlebrook private note");
  await syncBoth(server, phone);
  await run(`${D3}T03:30:00`); // D1 answers and research notes, D2 titles

  // D3: learned, the phone's learned words and the phone's highlight with a note (synced here).
  c.set(`${D3}T10:00:00`);
  await day(D3, NAME[D3]!, { exercise: true, checkin: true });
  await saveLearned(jk, D3, DEVICE, "Pretend Nettlecombe learned");
  await phoneLearned(phone, D3, "Pretend Orrisford phone learned");
  const phoneHid = await hl(D3, "pretend Umberlea weir", "Pretend Umberlea phone note", PHONE);
  await syncBoth(server, phone);
  await run(`${D3}T12:00:00`, true); // Send now
  await run(`${D4}T03:30:00`); // D2 answers due but private; D3 titles

  // D4: check-in only, with a highlight and learned words (no exercise that day).
  c.set(`${D4}T10:00:00`);
  await day(D4, NAME[D4]!, { checkin: true });
  await hl(D4, "pretend Vintondale moor", "Pretend Vintondale note");
  await saveLearned(jk, D4, DEVICE, "Pretend Pellinore learned on a check-in day");
  await syncBoth(server, phone);
  const file = JSON.parse(JSON.stringify(await exportBackup(D4)));
  // After the backup: D3's answer edited, learned words replaced, the highlight note changed.
  c.set(`${D4}T12:00:00`);
  await saveExerciseEdit(jk, D3, DEVICE, cardRef(set.cards.find((k) => k.id === "b-001")!), `Pretend ${NAME[D3]} edited exercise answer`);
  await saveLearned(jk, D3, DEVICE, "Pretend Larkspur second learned", { seen: (await readLearned(jk, D3)).seen });
  await saveHighlightNote(jk, DEVICE, openNoteSession((await listed(phoneHid))!), "Pretend Umberlea later note");
  await syncBoth(server, phone);
  await run(`${D5}T03:30:00`); // D3 answers (edited) and research notes, D4 titles

  // D5: only a highlight and learned words (no exercise, no check-in): no row ever.
  c.set(`${D5}T10:00:00`);
  await hl(D5, "pretend Wolverleigh fold", "Pretend Wolverleigh note");
  await saveLearned(jk, D5, DEVICE, "Pretend Quenby learned on a learned-only day");
  // D3's exercise ticked private on the phone after its answers went: overwritten.
  await phoneTick(phone, D3, "exercise", true);
  await syncBoth(server, phone);
  privateNow.add(`exercise:${D3}`);
  await run(`${D5}T12:00:00`);
  expect((await liveNotes(fake))[D3], "D3's exercise hidden after the phone's tick").toBe(note({ ex: true, ci: `Pretend ${NAME[D3]} check-in answer` }));
  await run("2026-11-07T03:30:00"); // D4 answers (check-in)

  // The Replace (sync off), with the backup made before D3's edit and before the phone's tick.
  c.set("2026-11-08T10:00:00");
  await stopSyncing(db);
  await restoreBackup(file, "replace");
  hold = true;
  await day(D6, NAME[D6]!, { exercise: true });
  await hl(D6, "pretend Yewbarrow cairn", "Pretend Yewbarrow note");
  for (const at of ["2026-11-08T10:05:00", "2026-11-08T20:00:00", "2026-11-09T03:30:00"]) await run(at, true);
  expect((await readSent(db))!.waitingRestore, "the box says answers are held").toBe(true);
  // Sync on again; the pull lands.
  c.set("2026-11-09T09:00:00");
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  await ok(db, server);
  hold = false;
  await run("2026-11-09T10:00:00");
  expect((await readSent(db))!.waitingRestore).toBe(false);
  await run("2026-11-10T03:30:00"); // D6 answers
  const settled = fake.requests.length;
  for (const at of ["2026-11-10T09:00:00", "2026-11-11T03:30:00", "2026-11-12T03:30:00"]) await run(at, true);
  expect(writes(fake, settled), "settles: nothing more after the pull").toEqual([]);
  return { c, fake, g, env, server, phone, NAME, RESEARCH, D1, D2, D3, D4, D5, D6 };
}

describe("scope: a recorder over every request, many days, two devices, a Replace and Stop", () => {
  it("only exercise / check-in titles, questions and (24 h after the day, not private) answers and that day's research notes ever go; nothing else of the journal", async () => {
    const { c, fake, g, env, server, phone, NAME, RESEARCH, D1, D2, D3, D4, D5, D6 } = await scopeRun();

    expect(await liveNotes(fake)).toEqual({
      [D1]: note({
        ex: `Pretend ${NAME[D1]} exercise answer`, research: ["Pretend Larkspur learned, kept", "pretend Rainsworth arch — Pretend Rainsworth note"],
        ci: `Pretend ${NAME[D1]} check-in answer`,
      }),
      [D2]: note({ ex: true, ci: true }),
      [D3]: note({ ex: true, ci: `Pretend ${NAME[D3]} check-in answer` }),
      [D4]: note({ ci: `Pretend ${NAME[D4]} check-in answer` }),
      [D6]: note({ ex: `Pretend ${NAME[D6]} exercise answer`, research: ["pretend Yewbarrow cairn — Pretend Yewbarrow note"] }),
    });
    // D3's research notes went with its answers, before the tick overwrote them.
    expect((await noteWrites(fake)).some((p) => p.day === D3 && p.note.includes("• Pretend Larkspur second learned\n• pretend Umberlea weir — Pretend Umberlea later note"))).toBe(true);
    expect(JSON.stringify([...fake.days.values()]), "overwritten: D3's answers are nowhere in Together now").not.toMatch(/Cobblewick edited exercise answer|Larkspur second/);

    c.set("2026-11-12T10:00:00");
    expect(await stopTogether(env, { markDeleted: true })).toEqual({ kind: "ok" });
    expect(liveDays(fake)).toEqual([]);

    // Positive scan: every note ever written holds only headings, titles, questions and that day's own answers and research notes.
    expect(g.violations).toEqual([]);
    const all = await noteWrites(fake);
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      const allowed = new Set([
        "", "Mental Health Exercise", "Check In", "Research notes", TITLE, Q,
        `Pretend ${NAME[p.day]} exercise answer`, `Pretend ${NAME[p.day]} edited exercise answer`, `Pretend ${NAME[p.day]} check-in answer`,
      ]);
      const r = RESEARCH[p.day] ?? [];
      for (let i = 0; i < r.length; i++) allowed.add(`• ${r[i]}`).add(`• ${r[i]} — ${r[i + 1]}`);
      for (const line of p.note.split("\n")) expect(allowed.has(line), `${p.day}: ${JSON.stringify(line)}`).toBe(true);
      expect([D1, D2, D3, D4, D6], "a row only for an exercise or check-in day").toContain(p.day);
    }
    expect(all.some((p) => p.day === D5), "a learned/highlight-only day").toBe(false);
    expect(wire(fake)).toContain(`Pretend ${NAME[D3]} edited exercise answer`); // the answers did go before the tick
    for (const r of g.seen) {
      expect(new URL(r.url).origin).toBe(fake.url);
      expect(new URL(r.url).pathname).toMatch(/^\/(auth\/v1\/token|rest\/v1\/(members|challenges|challenge_days))$/);
    }
    expect(fake.todos.size, "no to-dos at all").toBe(0);
    expect(fake.events.size).toBe(0);

    // Esmeworld itself: learned words and highlights are all still saved and shown, on both devices.
    expect((await readLearned(jk, D1)).text).toBe("Pretend Larkspur learned, kept");
    expect((await readLearned(jk, D3)).text, "the newest words, after the Replace and the pull").toBe("Pretend Larkspur second learned");
    expect((await readLearned(jk, D5)).text).toBe("Pretend Quenby learned on a learned-only day");
    const shown = (await listHighlights(jk)).highlights.map((h) => `${h.anchor.exact}|${h.note}`).sort();
    expect(shown).toEqual(
      [
        "pretend Rainsworth arch|Pretend Rainsworth note", "pretend Thistlebrook bend|Pretend Thistlebrook private note",
        "pretend Umberlea weir|Pretend Umberlea later note", "pretend Vintondale moor|Pretend Vintondale note",
        "pretend Wolverleigh fold|Pretend Wolverleigh note", "pretend Yewbarrow cairn|Pretend Yewbarrow note",
      ].sort(),
    );
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    await syncBoth(server, phone);
    const phoneKinds = (await phone.journal.toArray()).filter((r) => r.kind === "learned" || r.kind === "highlight").length;
    expect(phoneKinds, "the phone has them too").toBe((await db.journal.toArray()).filter((r) => r.kind === "learned" || r.kind === "highlight").length);
  });
});

describe("leak proofs: the recorder above catches a reader that sends other days' words", () => {
  for (const mode of ["learned", "highlight-note"] as const) {
    it(`a reader that adds every day's ${mode === "learned" ? "learned words" : "highlight notes"} to the exercise note is caught`, async () => {
      leak.mode = mode;
      const { g } = await scopeRun();
      expect(g.violations.length, "violations").toBeGreaterThan(0);
      expect(g.violations.join("\n")).toMatch(mode === "learned" ? /Mistlethwaite|Pellinore|Quenby/ : /Thistlebrook|Vintondale|Wolverleigh/);
    });
  }
});

// ================================================================ research notes: no churn, hiding, Replace, devices

describe("research notes (learned words and highlights) on a day that went: they follow her changes, a private tick overwrites them", () => {
  async function sentDay(D = "2026-11-04") {
    const c = clock(`${D}T09:00:00`);
    const fake = await signedIn(c);
    await day(D, "Halberton", { exercise: true, checkin: true });
    return { c, fake, D };
  }
  const CI = "Pretend Halberton check-in answer";
  const EX = "Pretend Halberton exercise answer";

  it("a highlight removed after its day went (on this device or the phone): the note is overwritten without it, once each; a replay sends nothing", async () => {
    const { c, fake, D } = await sentDay();
    const a = await hl(D, "pretend Kestrelby path", "Pretend Kestrelby note");
    const b = await hl(D, "pretend Zennor cliff", "Pretend Zennor note", PHONE);
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    expect((await liveNotes(fake))[D]).toBe(note({ ex: EX, research: ["pretend Kestrelby path — Pretend Kestrelby note", "pretend Zennor cliff — Pretend Zennor note"], ci: CI }));
    const from = fake.requests.length;
    await removeHighlight(jk, DEVICE, (await listed(a))!);
    await send(fake, c);
    expect((await liveNotes(fake))[D]).toBe(note({ ex: EX, research: ["pretend Zennor cliff — Pretend Zennor note"], ci: CI }));
    const h = (await listed(b))!;
    await removeHighlight(jk, PHONE, { heads: h.heads.filter((x) => x.hid === b) });
    await send(fake, c, true);
    expect((await liveNotes(fake))[D]).toBe(note({ ex: EX, ci: CI }));
    expect(await listed(a)).toBeUndefined();
    expect(writes(fake, from)).toHaveLength(2);
    const settled = fake.requests.length;
    await send(fake, c);
    expect(writes(fake, settled)).toEqual([]);
    expect(JSON.stringify([...fake.days.values()])).not.toMatch(/Kestrelby|Zennor/);
  });

  it("a note added or changed later on a sent day's highlight, and learned words added later: the note follows, once; a replay sends nothing", async () => {
    const { c, fake, D } = await sentDay();
    const hid = await hl(D, "pretend Netherby wall");
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    expect((await liveNotes(fake))[D]).toBe(note({ ex: EX, research: ["pretend Netherby wall"], ci: CI }));
    const from = fake.requests.length;
    await saveHighlightNote(jk, DEVICE, openNoteSession((await listed(hid))!), "Pretend Netherby later note");
    await saveLearned(jk, D, DEVICE, "Pretend Netherby learned later");
    await send(fake, c);
    await send(fake, c, true);
    expect(writes(fake, from)).toHaveLength(1);
    expect((await listed(hid))!.note).toBe("Pretend Netherby later note");
    expect((await liveNotes(fake))[D]).toBe(note({ ex: EX, research: ["Pretend Netherby learned later", "pretend Netherby wall — Pretend Netherby later note"], ci: CI }));
  });

  it("a day with highlights and learned words ticked private after its answers went: overwritten with titles only, the words nowhere in Together", async () => {
    const { c, fake, D } = await sentDay();
    await hl(D, "pretend Moorcastle bell", "Pretend Moorcastle note");
    await saveLearned(jk, D, DEVICE, "Pretend Moorcastle learned");
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    expect((await liveNotes(fake))[D]).toBe(note({ ex: EX, research: ["Pretend Moorcastle learned", "pretend Moorcastle bell — Pretend Moorcastle note"], ci: CI }));
    await saveSharePrivate(jk, D, "exercise", true);
    await send(fake, c);
    expect((await liveNotes(fake))[D]).toBe(note({ ex: true, ci: CI }));
    expect(liveDays(fake)).toHaveLength(1);
    expect(JSON.stringify([...fake.days.values()])).not.toMatch(/Moorcastle|Halberton exercise answer/);
  });

  it("the same words highlighted on 3 days on 3 devices, the middle day private: each day's own note with its answers, the private day titles only; the app still shows one highlight", async () => {
    const D1 = "2026-11-02", D2 = "2026-11-03", D3 = "2026-11-04";
    const c = clock(`${D1}T09:00:00`);
    const fake = await signedIn(c);
    await day(D1, "Ivelet", { exercise: true });
    await day(D2, "Jervaulx", { exercise: true });
    await day(D3, "Keldholme", { exercise: true });
    await hl(D1, "pretend Yarrowby steps", "Pretend Yarrowby first note");
    await hl(D2, "pretend Yarrowby steps", "Pretend Yarrowby private note", PHONE);
    await hl(D3, "pretend Yarrowby steps", "Pretend Yarrowby third note", "device-pretend-tablet-03");
    await saveSharePrivate(jk, D2, "exercise", true);
    expect((await listHighlights(jk)).highlights, "set-up: shown as one").toHaveLength(1);
    for (const at of ["2026-11-04T03:30:00", "2026-11-05T03:30:00", "2026-11-06T03:30:00", "2026-11-07T03:30:00"]) {
      c.set(at);
      await send(fake, c);
    }
    expect(await liveNotes(fake)).toEqual({
      [D1]: note({ ex: "Pretend Ivelet exercise answer", research: ["pretend Yarrowby steps — Pretend Yarrowby first note"] }),
      [D2]: note({ ex: true }),
      [D3]: note({ ex: "Pretend Keldholme exercise answer", research: ["pretend Yarrowby steps — Pretend Yarrowby third note"] }),
    });
    expect(wire(fake)).not.toMatch(/Yarrowby private note|Jervaulx exercise answer/);
  });

  it("removed on one device while the other changed its note: the app keeps it with the new note; Together gets that note, never the first", async () => {
    const { c, fake, D } = await sentDay();
    const hid = await hl(D, "pretend Ashwater ford", "Pretend Ashwater first note");
    const seenByBoth = (await listed(hid))!;
    await removeHighlight(jk, DEVICE, seenByBoth);
    await saveHighlightNote(jk, PHONE, openNoteSession(seenByBoth), "Pretend Ashwater phone note");
    expect((await listed(hid))?.note).toBe("Pretend Ashwater phone note");
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    expect((await liveNotes(fake))[D]).toBe(note({ ex: EX, research: ["pretend Ashwater ford — Pretend Ashwater phone note"], ci: CI }));
    expect(wire(fake)).not.toMatch(/Ashwater first note/);
  });

  it("mixed (#59): D1's check-in incomplete (an answer row won't open), D2 private, D3 normal: D1's check-in never with answers (its exercise goes), D2 titles only, D3 with answers; 6 more runs change nothing", async () => {
    const D1 = "2026-11-02", D2 = "2026-11-03", D3 = "2026-11-04";
    const c = clock(`${D1}T09:00:00`);
    const fake = await signedIn(c);
    await day(D1, "Birchmoor", { exercise: true, checkin: true });
    await day(D2, "Calderby", { exercise: true, checkin: true });
    await day(D3, "Dovecote", { exercise: true, checkin: true });
    const other = await keyFor("fake-journal-some-other-key");
    const id = `answer:${D1}:0a1b2c3d4e5f:${PHONE}`;
    await db.journal.put({ id, kind: "answer", date: D1, fp: other.fp, ...(await sealJson(other.key, { v: 1, pretend: "answer" }, journalAad(id))) } as never);
    await saveSharePrivate(jk, D2, "exercise", true);
    await saveSharePrivate(jk, D2, "checkin", true);
    for (const at of ["2026-11-03T03:30:00", "2026-11-04T03:30:00", "2026-11-05T03:30:00", "2026-11-06T03:30:00"]) {
      c.set(at);
      await send(fake, c);
    }
    expect(wire(fake)).not.toMatch(/Birchmoor check-in answer|Calderby/);
    const live = await liveNotes(fake);
    expect(live[D3]).toBe(note({ ex: "Pretend Dovecote exercise answer", ci: "Pretend Dovecote check-in answer" }));
    expect(live[D2]).toBe(note({ ex: true, ci: true }));
    expect(live[D1]).toBe(note({ ex: "Pretend Birchmoor exercise answer", ci: true }));
    const k = fake.requests.length;
    for (let i = 0; i < 6; i++) {
      c.advance(60 * 60 * 1000);
      await send(fake, c, i % 2 === 0);
    }
    expect(writes(fake, k), "churn").toEqual([]);
    const rec = (await readSent(db))!.days!;
    expect(rec[D3]).toMatchObject({ live: true, parts: { exercise: "answers", checkin: "answers" } });
    expect(rec[D2]).toMatchObject({ live: true, parts: { exercise: "titles", checkin: "titles" } });
  });

  it("an unreadable learned or highlight row (#59): that day's exercise part goes titles-only, never with answers or research notes; its check-in still goes", async () => {
    const D = "2026-11-04";
    const { c, fake } = await sentDay(D);
    const other = await keyFor("fake-journal-some-other-key");
    for (const id of [`learned:${D}:${PHONE}_0a1b2c`, `highlight:${D}:0123456789abcdef_${PHONE}_0a1b2c3d`]) {
      const kind = id.split(":")[0];
      await db.journal.put({ id, kind, date: D, fp: other.fp, ...(await sealJson(other.key, { v: 1, pretend: kind }, journalAad(id))) } as never);
    }
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    await send(fake, c, true);
    expect(wire(fake)).not.toContain(EX);
    expect((await liveNotes(fake))[D]).toBe(note({ ex: true, ci: CI }));
  });

  it("after a Replace: learned words and highlights written from a page holding the former id are saved under the current id and shown; Together gets no write while held, then that day's note once", async () => {
    const D = "2026-11-04";
    const c = clock(`${D}T09:00:00`);
    await stopSyncing(db);
    const fake = await signedIn(c);
    await day(D, "Halberton", { exercise: true });
    const before = await getDeviceId(db);
    await saveLearned(jk, D, before, "Pretend Quarrydown learned");
    await hl(D, "pretend Quarrydown fence", "Pretend Quarrydown note", before);
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    const file = JSON.parse(JSON.stringify(await exportBackup(D)));
    await restoreBackup(file, "replace");
    const after = await getDeviceId(db);
    expect(after).not.toBe(before);
    const from = fake.requests.length;
    const lidNew = await saveLearned(jk, D, before, "Pretend Quarrydown learned, and more after the Replace", { seen: (await readLearned(jk, D)).seen });
    expect(lidNew.startsWith(`learned:${D}:${after}_`)).toBe(true);
    const hid = await hl(D, "pretend Ravensgill bridge", "Pretend Ravensgill note", before);
    const rows = (await db.journal.where("kind").equals("highlight").toArray()).filter((r) => r.id.startsWith(`highlight:${D}:${hid}_`) || r.id.includes(`${hid}_`));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.id.includes(after))).toBe(true);
    await saveHighlightNote(jk, before, openNoteSession((await listed(hid))!), "Pretend Ravensgill note, changed");
    expect((await readLearned(jk, D)).text).toBe("Pretend Quarrydown learned, and more after the Replace");
    expect((await listed(hid))!.note).toBe("Pretend Ravensgill note, changed");
    for (const at of ["2026-11-06T04:00:00", "2026-11-07T03:59:00"]) {
      c.set(at);
      await send(fake, c, true);
    }
    expect(writes(fake, from), "held (sync off: 24 h from the first run after the Replace)").toEqual([]);
    expect(wire(fake)).not.toMatch(/Ravensgill|and more after the Replace/);
    for (const at of ["2026-11-07T05:00:00", "2026-11-08T03:30:00"]) {
      c.set(at);
      await send(fake, c, true);
    }
    expect(writes(fake, from)).toHaveLength(1);
    expect((await liveNotes(fake))[D]).toBe(note({
      ex: "Pretend Halberton exercise answer",
      research: ["Pretend Quarrydown learned, and more after the Replace", "pretend Quarrydown fence — Pretend Quarrydown note", "pretend Ravensgill bridge — Pretend Ravensgill note, changed"],
    }));
  });
});

// ================================================================ #64 / #65 for answers

/** Day D sent with answers ("final"), the backup holding the older "first" answer; day E written and synced, not due yet at the Replace. */
async function replaceSetUp() {
  const D = "2026-11-04", E = "2026-11-05";
  const c = clock(`${D}T10:00:00`);
  const fake = await signedIn(c);
  const server = new FakeSyncServer(TOKEN);
  const phone = await phoneDevice();
  const { card } = await day(D, "Gildersleeve", { exercise: true, checkin: true });
  await saveExerciseEdit(jk, D, DEVICE, cardRef(card), "Pretend Gildersleeve first answer");
  await syncBoth(server, phone);
  c.set(`${E}T10:00:00`);
  await day(E, "Heathcote", { exercise: true, checkin: true });
  await syncBoth(server, phone);
  const file = JSON.parse(JSON.stringify(await exportBackup(E)));
  await saveExerciseEdit(jk, D, DEVICE, cardRef(card), "Pretend Gildersleeve final answer");
  await syncBoth(server, phone);
  c.set("2026-11-06T03:30:00");
  await send(fake, c);
  expect((await liveNotes(fake))[D], "set-up: D's answers went, final").toBe(note({ ex: "Pretend Gildersleeve final answer", ci: "Pretend Gildersleeve check-in answer" }));
  expect((await liveNotes(fake))[E], "set-up: E titles only").toBe(note({ ex: true, ci: true }));
  return { c, fake, server, phone, file, D, E, card };
}

describe("#64 / #65: after a Replace, for answers", () => {
  it("sync off: answers held exactly 24 h from the first run after the Replace; the restored older answer never goes in the gap; the box flag on, then off", async () => {
    const { c, fake, file, E } = await replaceSetUp();
    await stopSyncing(db);
    c.set("2026-11-06T09:00:00");
    await restoreBackup(file, "replace");
    const from = fake.requests.length;
    await send(fake, c, true); // first run after the Replace: noticed here
    const T = c.now();
    expect((await readSent(db))!.waitingRestore).toBe(true);
    for (const ms of [60_000, 12 * 3_600_000, 23 * 3_600_000, 24 * 3_600_000 - 1000]) {
      c.set(new Date(T).toISOString());
      c.advance(ms);
      await send(fake, c, true);
      expect((await readSent(db))!.waitingRestore, `held at +${ms}ms`).toBe(true);
    }
    expect(writes(fake, from), "nothing at all in the gap (D sent with answers, E's answers due at 11-07 03:00)").toEqual([]);
    expect(wire(fake)).not.toContain("Pretend Gildersleeve first answer");
    expect(wire(fake)).not.toContain("Pretend Heathcote");
    // Exactly 24 h: held no more.
    const at24 = fake.requests.length;
    c.set(new Date(T).toISOString());
    c.advance(24 * 3_600_000);
    await send(fake, c);
    expect((await readSent(db))!.waitingRestore).toBe(false);
    expect((await liveNotes(fake))[E], "E's answers go at 24 h").toBe(note({ ex: "Pretend Heathcote exercise answer", ci: "Pretend Heathcote check-in answer" }));
    expect((await noteWrites(fake, at24)).filter((p) => p.day === E), "E's answers once").toHaveLength(1);
    const settled = fake.requests.length;
    await send(fake, c);
    await send(fake, c, true);
    expect(writes(fake, settled)).toEqual([]);
  });

  it("sync on but it never pulls (offline for weeks): held the whole time, Send now never sends an answer, D never rebuilt; once the pull lands everything settles in one run", async () => {
    const { c, fake, server, phone, file, D, E } = await replaceSetUp();
    await stopSyncing(db);
    c.set("2026-11-06T09:00:00");
    await restoreBackup(file, "replace");
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    const offline = (async () => {
      throw new TypeError("pretend: offline");
    }) as typeof fetch;
    const from = fake.requests.length;
    for (let i = 0; i < 30; i++) {
      c.advance(24 * 3_600_000);
      expect((await syncOnce({ db, fetch: offline })).kind).not.toBe("ok");
      await send(fake, c, true);
      expect((await readSent(db))!.waitingRestore, `day ${i}`).toBe(true);
    }
    expect(writes(fake, from), "nothing at all while held").toEqual([]);
    expect(wire(fake)).not.toMatch(/Gildersleeve first answer|Heathcote exercise answer|Heathcote check-in answer/);
    // The phone ticks E's check-in private meanwhile (server only).
    await phoneTick(phone, E, "checkin", true);
    await ok(phone, server);
    await ok(db, server);
    const after = fake.requests.length;
    await send(fake, c);
    expect((await readSent(db))!.waitingRestore).toBe(false);
    const live = await liveNotes(fake);
    expect(live[D]).toBe(note({ ex: "Pretend Gildersleeve final answer", ci: "Pretend Gildersleeve check-in answer" }));
    expect(live[E], "the phone's tick, pulled, honoured").toBe(note({ ex: "Pretend Heathcote exercise answer", ci: true }));
    expect(wire(fake)).not.toMatch(/Gildersleeve first answer|Heathcote check-in answer/);
    const once = fake.requests.length;
    for (let i = 0; i < 4; i++) await send(fake, c, i % 2 === 0);
    expect(writes(fake, once), "settled once").toEqual([]);
    expect((await noteWrites(fake, after)).filter((p) => p.day === D), "D not touched (Together already had the final answer)").toEqual([]);
  });

  it("in the gap: a private tick on this device still overwrites a day already sent with answers, and stays so after the pull", async () => {
    const { c, fake, server, file, D } = await replaceSetUp();
    await stopSyncing(db);
    await restoreBackup(file, "replace");
    await saveSharePrivate(jk, D, "exercise", true);
    await saveSharePrivate(jk, D, "checkin", true);
    await send(fake, c, true);
    expect((await liveNotes(fake))[D]).toBe(note({ ex: true, ci: true }));
    expect(JSON.stringify([...fake.days.values()])).not.toMatch(/Gildersleeve/);
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    await ok(db, server);
    const from = fake.requests.length;
    await send(fake, c);
    await send(fake, c);
    expect(writes(fake, from), "nothing re-sent after the pull").toEqual([]);
    expect(wire(fake)).not.toContain("Gildersleeve first answer");
  });

  it("in the gap: Stop with removing still removes everything", async () => {
    const { c, fake, file } = await replaceSetUp();
    await stopSyncing(db);
    await restoreBackup(file, "replace");
    await send(fake, c, true);
    expect(await stopTogether({ fetch: fake.fetch, now: c.now }, { markDeleted: true })).toEqual({ kind: "ok" });
    expect(liveDays(fake)).toEqual([]);
  });

  it("BUG: a backup older than a day already sent with answers: Send now in the gap never removes that day from Together (only a private tick may hide it)", async () => {
    // The backup was made BEFORE day D was written; D went to Together with answers. After the
    // Replace (sync off) the restored journal has no D at all, but sync hasn't pulled yet: D isn't
    // gone, only not here yet. Nothing she did says to hide it.
    const D = "2026-11-04";
    const c = clock("2026-11-03T10:00:00");
    const fake = await signedIn(c);
    const server = new FakeSyncServer(TOKEN);
    const phone = await phoneDevice();
    await journalDay("2026-11-03", {}); // the card file
    await syncBoth(server, phone);
    const file = JSON.parse(JSON.stringify(await exportBackup("2026-11-03")));
    c.set(`${D}T10:00:00`);
    await day(D, "Lindisfarne", { exercise: true, checkin: true });
    await syncBoth(server, phone);
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    const sentNote = note({ ex: "Pretend Lindisfarne exercise answer", ci: "Pretend Lindisfarne check-in answer" });
    expect((await liveNotes(fake))[D], "set-up").toBe(sentNote);
    await stopSyncing(db);
    await restoreBackup(file, "replace");
    const from = fake.requests.length;
    await send(fake, c, true); // Send now in the gap
    const gap = writes(fake, from);
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    await ok(db, server);
    await send(fake, c);
    expect({
      inTheGap: gap,
      afterThePull: writes(fake, from),
      liveAfter: await liveNotes(fake),
    }, "D removed from Together in the gap (a journal that simply hasn't pulled yet), then written again after the pull").toEqual({
      inTheGap: [],
      afterThePull: [],
      liveAfter: { [D]: sentNote },
    });
  });

  it("ticks across devices in the gap: the phone UNticks a day the Mac had hidden; held until the pull, then its answers go once", async () => {
    const D = "2026-11-04";
    const c = clock(`${D}T10:00:00`);
    const fake = await signedIn(c);
    const server = new FakeSyncServer(TOKEN);
    const phone = await phoneDevice();
    await day(D, "Mardale", { exercise: true });
    await saveSharePrivate(jk, D, "exercise", true);
    await syncBoth(server, phone);
    const file = JSON.parse(JSON.stringify(await exportBackup(D)));
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    expect((await liveNotes(fake))[D]).toBe(note({ ex: true }));
    await stopSyncing(db);
    await restoreBackup(file, "replace");
    await phoneTick(phone, D, "exercise", false);
    await ok(phone, server);
    const from = fake.requests.length;
    for (let i = 0; i < 3; i++) {
      c.advance(3_600_000);
      await send(fake, c, true);
    }
    expect(writes(fake, from)).toEqual([]);
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    await ok(db, server);
    await send(fake, c);
    await send(fake, c);
    expect((await liveNotes(fake))[D]).toBe(note({ ex: "Pretend Mardale exercise answer" }));
    expect((await noteWrites(fake, from)).filter((p) => /Mardale/.test(p.note))).toHaveLength(1);
  });

  it("a second Replace after the first hold ended holds again; a Replace while signed out of Together (Stop, not removing) is still noticed after signing in again", async () => {
    const { c, fake, file } = await replaceSetUp();
    await stopSyncing(db);
    await restoreBackup(file, "replace");
    await send(fake, c, true);
    c.advance(24 * 3_600_000);
    await send(fake, c);
    expect((await readSent(db))!.waitingRestore).toBe(false);
    await restoreBackup(file, "replace");
    await send(fake, c, true);
    expect((await readSent(db))!.waitingRestore, "second Replace").toBe(true);
    c.advance(24 * 3_600_000);
    await send(fake, c);
    expect(await stopTogether({ fetch: fake.fetch, now: c.now }, { markDeleted: false })).toEqual({ kind: "ok" });
    await restoreBackup(file, "replace");
    expect(await signInToTogether({ fetch: fake.fetch, now: c.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD })).toEqual({ kind: "ok" });
    const from = fake.requests.length;
    await send(fake, c, true);
    expect((await readSent(db))!.waitingRestore, "Replace while signed out").toBe(true);
    expect((await noteWrites(fake, from)).filter((p) => /answer/.test(p.note))).toEqual([]);
  });

  it("DESIGN NOTE (sync off, after 24 h): a day already sent is rebuilt from the restored journal, so an older answer she had replaced (never sent) goes to Together", async () => {
    // Not a BUG test: this documents what "answers go as usual after 24 h with sync off" means for
    // a day Together already had. Passing = the current behaviour. For Esme to decide.
    const { c, fake, file, D } = await replaceSetUp();
    await stopSyncing(db);
    await restoreBackup(file, "replace");
    await send(fake, c, true);
    c.advance(24 * 3_600_000);
    await send(fake, c);
    expect((await liveNotes(fake))[D]).toBe(note({ ex: "Pretend Gildersleeve first answer", ci: "Pretend Gildersleeve check-in answer" }));
  });
});
