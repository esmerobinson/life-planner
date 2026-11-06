// TESTING (Life Planner - Together Round 7 Testing, 2026-11-06): Together v1 sends ONLY the
// Mental health exercise and Daily check-in (titles at the 3am day change, answers 24 h after the
// day ends, titles only for a day ticked private). "What I learned today" and highlights (with
// their notes) never go, but still work in Esmeworld. Also round 7's #64 / #65 (after a Replace a
// day already sent is only hidden; sync on: wait for the first pull; sync off: 24 h).
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
import { clock, DEVICE, EMAIL, fakeTogether, guardedFetch, journalDay, PASSWORD, send, signedIn } from "../together/testKit";
import { FakeSyncServer } from "./fakeServer";
import { getDeviceId, saveSyncSettings, stopSyncing, syncOnce } from "./engine";

const leak = vi.hoisted(() => ({ mode: "none" as "none" | "learned" | "highlight-note" }));

// Leak proofs only: a deliberately broken COPY of the sender's journal reader (in this file only,
// no app code changed) that adds the day's learned words or highlight notes to the exercise note,
// as the earlier send code did. The recorder must catch both.
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
          ? (await repo.readLearned(args[0], d)).text
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
const habit = (kind: "exercise" | "checkin") => togetherId("habit", kind, 1);
async function liveNotes(fake: FakeSupabase, kind: "exercise" | "checkin" = "exercise"): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of fake.liveTallies(await habit(kind))) out[String(e.at).slice(0, 10)] = String(e.note ?? "");
  return out;
}
const wire = (fake: FakeSupabase) => JSON.stringify(fake.requests);
const writes = (fake: FakeSupabase, from: number) =>
  fake.requests.slice(from).filter((r) => r.method !== "GET" && r.url.includes("/rest/v1/")).map((r) => `${r.method} ${new URL(r.url).pathname} ${r.body.slice(0, 100)}`);
const tallyPosts = (fake: FakeSupabase, from = 0) =>
  fake.requests.slice(from).filter((r) => r.method === "POST" && r.url.includes("/rest/v1/todo_events")).map((r) => JSON.parse(r.body) as { at: string; note: string | null; todo_id: string });

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

// ================================================================ the v1 scope recorder

/** The whole v1 scope run (see the test below), returning what the checks need. */
async function scopeRun() {
  const D1 = "2026-11-02", D2 = "2026-11-03", D3 = "2026-11-04", D4 = "2026-11-05", D5 = "2026-11-06", D6 = "2026-11-08";
  const NAME: Record<string, string> = { [D1]: "Amberlode", [D2]: "Brindlemoss", [D3]: "Cobblewick", [D4]: "Dapplecombe", [D5]: "Eldergrove", [D6]: "Fernhallow" };
  const c = clock(`${D1}T09:00:00`);
  const fake = fakeTogether(c);
  const server = new FakeSyncServer(TOKEN);
  const phone = await phoneDevice();
  // Never, in any request (address, headers, body, any string in it), on any day.
  const NEVER = [
    // what I learned (box, replaced versions, the phone's, a private day's, a learned-only day's)
    "Pretend Larkspur learned", "Pretend Larkspur first learned", "Pretend Larkspur second learned", "Pretend Mistlethwaite learned",
    "Pretend Nettlecombe learned", "Pretend Orrisford phone learned", "Pretend Pellinore learned", "Pretend Quenby learned",
    // highlights and notes (kept, removed, private day, phone's, later note, no-exercise day, highlight-only day, today)
    "Rainsworth", "Pretend Rainsworth note", "Saltmarsh", "Thistlebrook", "Umberlea", "Pretend Umberlea phone note", "Pretend Umberlea later note",
    "Vintondale", "Wolverleigh", "Yewbarrow",
    // headings
    "Highlighted learnings", "Highlighted", "What I learned",
    // every other journal part, to-dos
    "Pretend Zennorwick morning page", "Pretend Zennorwick morning draft", "Pretend Zennorwick hard thought", "Pretend Zennorwick steady",
    "Pretend Zennorwick draft answer", "Pretend Zennorwick to-do", "Pretend Zennorwick to-do notes", btoa("pretend-r7-jpeg-bytes"),
    // a private day's answers; the restored (older) answer she had replaced before it ever went
    "Pretend Brindlemoss exercise answer", "Pretend Brindlemoss check-in answer", "Pretend Cobblewick exercise answer",
    TOKEN, jk.fp,
  ];
  const privateNow = new Set<string>([`exercise:${D2}`, `checkin:${D2}`]);
  let hold = false; // after the Replace, until the pull: no answers at all
  let signedInNow = false;
  const forbidden = () => {
    const out = [...NEVER, ...(signedInNow ? [PASSWORD] : [])];
    for (const [d, name] of Object.entries(NAME)) {
      for (const [kind, label] of [["exercise", "exercise"], ["checkin", "check-in"]] as const) {
        const words = d === D3 && kind === "exercise" ? `Pretend ${name} edited exercise answer` : `Pretend ${name} ${label} answer`;
        if (hold || c.now() < dueAt(d) || privateNow.has(`${kind}:${d}`)) out.push(words);
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
  await run(`${D3}T03:30:00`); // D1 answers, D2 titles

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
  await run(`${D5}T03:30:00`); // D3 answers (edited), D4 titles

  // D5: only a highlight and learned words (no exercise, no check-in): no tally ever.
  c.set(`${D5}T10:00:00`);
  await hl(D5, "pretend Wolverleigh fold", "Pretend Wolverleigh note");
  await saveLearned(jk, D5, DEVICE, "Pretend Quenby learned on a learned-only day");
  // D3's exercise ticked private on the phone after its answers went: hidden.
  await phoneTick(phone, D3, "exercise", true);
  await syncBoth(server, phone);
  privateNow.add(`exercise:${D3}`);
  await run(`${D5}T12:00:00`);
  expect((await liveNotes(fake))[D3], "D3 hidden after the phone's tick").toBe(TITLE);
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
  return { c, fake, g, env, server, phone, NAME, D1, D2, D3, D4, D5, D6 };
}

describe("v1 scope: a recorder over every request, many days, two devices, a Replace and Stop", () => {
  it("only exercise / check-in titles and (24 h after the day, not private) answers ever go; no learned words, highlight, note or heading, nor any other journal words", async () => {
    const { c, fake, g, env, server, phone, NAME, D1, D2, D3, D4, D5, D6 } = await scopeRun();

    const ex = await liveNotes(fake, "exercise");
    const ci = await liveNotes(fake, "checkin");
    expect(ex).toEqual({
      [D1]: `${TITLE}\nPretend ${NAME[D1]} exercise answer`,
      [D2]: TITLE,
      [D3]: TITLE,
      [D6]: `${TITLE}\nPretend ${NAME[D6]} exercise answer`,
    });
    expect(ci).toEqual({
      [D1]: `${PROMPTS[0]!.text}\nPretend ${NAME[D1]} check-in answer`,
      [D2]: PROMPTS[0]!.text,
      [D3]: `${PROMPTS[0]!.text}\nPretend ${NAME[D3]} check-in answer`,
      [D4]: `${PROMPTS[0]!.text}\nPretend ${NAME[D4]} check-in answer`,
    });

    c.set("2026-11-12T10:00:00");
    expect(await stopTogether(env, { markDeleted: true })).toEqual({ kind: "ok" });
    expect(fake.liveTallies(await habit("exercise"))).toEqual([]);
    expect(fake.liveTallies(await habit("checkin"))).toEqual([]);

    // Positive scan: every tally ever inserted holds only titles, questions and that day's own answers.
    expect(g.violations).toEqual([]);
    for (const p of tallyPosts(fake)) {
      const date = p.at.slice(0, 10);
      const allowed = new Set([TITLE, PROMPTS[0]!.text, `Pretend ${NAME[date]} exercise answer`, `Pretend ${NAME[date]} edited exercise answer`, `Pretend ${NAME[date]} check-in answer`]);
      for (const line of String(p.note ?? "").split("\n")) expect(allowed.has(line), `${date}: ${JSON.stringify(line)}`).toBe(true);
      expect([D1, D2, D3, D4, D6], "a tally only for an exercise or check-in day").toContain(date);
    }
    expect(tallyPosts(fake).some((p) => p.at.startsWith(D5)), "a learned/highlight-only day").toBe(false);
    expect(wire(fake)).toContain(`Pretend ${NAME[D3]} edited exercise answer`); // the answers did go before the tick
    for (const r of g.seen) {
      expect(new URL(r.url).origin).toBe(fake.url);
      expect(new URL(r.url).pathname).toMatch(/^\/(auth\/v1\/token|rest\/v1\/(members|todos|todo_events))$/);
    }
    expect([...fake.todos.values()].map((x) => x.type)).toEqual(["habit", "habit"]);

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

describe("leak proofs: the recorder above catches the old send code", () => {
  for (const mode of ["learned", "highlight-note"] as const) {
    it(`a reader that adds ${mode === "learned" ? "learned words" : "highlight notes"} to the exercise note is caught`, async () => {
      leak.mode = mode;
      const { g } = await scopeRun();
      expect(g.violations.length, "violations").toBeGreaterThan(0);
      expect(g.violations.join("\n")).toMatch(mode === "learned" ? /Larkspur/ : /Rainsworth note|Umberlea/);
    });
  }
});

// ================================================================ v1 versions of the 9 skipped tests

describe("v1 replacements for the skipped highlight/learned tests (what still matters: no churn, hiding, Replace, devices)", () => {
  async function sentDay(D = "2026-11-04") {
    const c = clock(`${D}T09:00:00`);
    const fake = await signedIn(c);
    await day(D, "Halberton", { exercise: true, checkin: true });
    return { c, fake, D };
  }

  it("a highlight removed after its day went (on this device or the phone): nothing is sent, nothing churns; the app no longer shows it", async () => {
    const { c, fake, D } = await sentDay();
    const a = await hl(D, "pretend Kestrelby path", "Pretend Kestrelby note");
    const b = await hl(D, "pretend Zennor cliff", "Pretend Zennor note", PHONE);
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    const from = fake.requests.length;
    await removeHighlight(jk, DEVICE, (await listed(a))!);
    await send(fake, c);
    const h = (await listed(b))!;
    await removeHighlight(jk, PHONE, { heads: h.heads.filter((x) => x.hid === b) });
    await send(fake, c, true);
    expect(writes(fake, from)).toEqual([]);
    expect(await listed(a)).toBeUndefined();
    expect(wire(fake)).not.toMatch(/Kestrelby|Zennor|Highlighted/);
  });

  it("a note added or changed later on a sent day's highlight, and learned words added later: nothing is sent; a replay sends nothing", async () => {
    const { c, fake, D } = await sentDay();
    const hid = await hl(D, "pretend Netherby wall");
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    const from = fake.requests.length;
    await saveHighlightNote(jk, DEVICE, openNoteSession((await listed(hid))!), "Pretend Netherby later note");
    await saveLearned(jk, D, DEVICE, "Pretend Netherby learned later");
    await send(fake, c);
    await send(fake, c, true);
    expect(writes(fake, from)).toEqual([]);
    expect((await listed(hid))!.note).toBe("Pretend Netherby later note");
    expect(wire(fake)).not.toMatch(/Netherby/);
  });

  it("a day with highlights and learned words ticked private after its answers went: hidden (titles only), the words never anywhere", async () => {
    const { c, fake, D } = await sentDay();
    await hl(D, "pretend Moorcastle bell", "Pretend Moorcastle note");
    await saveLearned(jk, D, DEVICE, "Pretend Moorcastle learned");
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    expect((await liveNotes(fake))[D]).toBe(`${TITLE}\nPretend Halberton exercise answer`);
    await saveSharePrivate(jk, D, "exercise", true);
    await send(fake, c);
    expect((await liveNotes(fake))[D]).toBe(TITLE);
    expect(fake.liveTallies(await habit("exercise"))).toHaveLength(1);
    expect(wire(fake)).not.toMatch(/Moorcastle/);
  });

  it("the same words highlighted on 3 days on 3 devices, the middle day private: each day's answers as usual, the private day titles only, no note anywhere; the app still shows one highlight", async () => {
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
      [D1]: `${TITLE}\nPretend Ivelet exercise answer`, [D2]: TITLE, [D3]: `${TITLE}\nPretend Keldholme exercise answer`,
    });
    expect(wire(fake)).not.toMatch(/Yarrowby|Jervaulx exercise answer/);
  });

  it("removed on one device while the other changed its note: the app keeps it with the new note; Together never gets either", async () => {
    const { c, fake, D } = await sentDay();
    const hid = await hl(D, "pretend Ashwater ford", "Pretend Ashwater first note");
    const seenByBoth = (await listed(hid))!;
    await removeHighlight(jk, DEVICE, seenByBoth);
    await saveHighlightNote(jk, PHONE, openNoteSession(seenByBoth), "Pretend Ashwater phone note");
    expect((await listed(hid))?.note).toBe("Pretend Ashwater phone note");
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    expect((await liveNotes(fake))[D]).toBe(`${TITLE}\nPretend Halberton exercise answer`);
    expect(wire(fake)).not.toMatch(/Ashwater/);
  });

  it("mixed (#59): D1 incomplete (an answer row won't open), D2 private, D3 normal: D1 never with answers, D2 titles only, D3 with answers; 6 more runs change nothing", async () => {
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
    const ex = await liveNotes(fake, "exercise");
    const ci = await liveNotes(fake, "checkin");
    expect(ex[D3]).toBe(`${TITLE}\nPretend Dovecote exercise answer`);
    expect(ex[D2]).toBe(TITLE);
    expect(ci[D3]).toBe(`${PROMPTS[0]!.text}\nPretend Dovecote check-in answer`);
    expect(ci[D2] ?? "").not.toContain("Calderby");
    expect(ci[D1] ?? "").not.toContain("Birchmoor");
    const k = fake.requests.length;
    for (let i = 0; i < 6; i++) {
      c.advance(60 * 60 * 1000);
      await send(fake, c, i % 2 === 0);
    }
    expect(writes(fake, k), "churn").toEqual([]);
    const rec = (await readSent(db))!;
    expect(rec.tallies[`exercise:${D3}`]).toMatchObject({ live: true, answers: true });
    expect(rec.tallies[`exercise:${D2}`]).toMatchObject({ live: true, answers: false });
    expect(rec.tallies[`checkin:${D2}`]).toMatchObject({ live: true, answers: false });
  });

  it("an unreadable learned or highlight row (never sent in v1) doesn't hold back that day's answers, and isn't sent", async () => {
    const D = "2026-11-04";
    const { c, fake } = await sentDay(D);
    const other = await keyFor("fake-journal-some-other-key");
    for (const id of [`learned:${D}:${PHONE}_0a1b2c`, `highlight:${D}:0123456789abcdef_${PHONE}_0a1b2c3d`]) {
      const kind = id.split(":")[0];
      await db.journal.put({ id, kind, date: D, fp: other.fp, ...(await sealJson(other.key, { v: 1, pretend: kind }, journalAad(id))) } as never);
    }
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    expect((await liveNotes(fake))[D]).toBe(`${TITLE}\nPretend Halberton exercise answer`);
  });

  it("after a Replace: learned words and highlights written from a page holding the former id are saved under the current id and shown; Together gets no write and none of the words", async () => {
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
    for (const at of ["2026-11-06T04:00:00", "2026-11-07T05:00:00", "2026-11-08T03:30:00"]) {
      c.set(at);
      await send(fake, c, true);
    }
    expect(writes(fake, from)).toEqual([]);
    expect(wire(fake)).not.toMatch(/Quarrydown|Ravensgill/);
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
  expect((await liveNotes(fake))[D], "set-up: D's answers went, final").toBe(`${TITLE}\nPretend Gildersleeve final answer`);
  expect((await liveNotes(fake))[E], "set-up: E titles only").toBe(TITLE);
  return { c, fake, server, phone, file, D, E, card };
}

describe("#64 / #65: after a Replace, for answers", () => {
  it("sync off: answers held exactly 24 h from the first run after the Replace; the restored older answer never goes in the gap; the box flag on, then off", async () => {
    const { c, fake, file, D, E } = await replaceSetUp();
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
    expect((await liveNotes(fake))[E], "E's answers go at 24 h").toBe(`${TITLE}\nPretend Heathcote exercise answer`);
    const posts = tallyPosts(fake, at24).filter((p) => p.at.startsWith(E));
    expect(posts.length, "E's answers once per habit").toBe(2);
    const settled = fake.requests.length;
    await send(fake, c);
    await send(fake, c, true);
    expect(writes(fake, settled)).toEqual([]);
    void D;
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
    const ex = await liveNotes(fake, "exercise");
    const ci = await liveNotes(fake, "checkin");
    expect(ex[D]).toBe(`${TITLE}\nPretend Gildersleeve final answer`);
    expect(ex[E]).toBe(`${TITLE}\nPretend Heathcote exercise answer`);
    expect(ci[E], "the phone's tick, pulled, honoured").toBe(PROMPTS[0]!.text);
    expect(wire(fake)).not.toMatch(/Gildersleeve first answer|Heathcote check-in answer/);
    const once = fake.requests.length;
    for (let i = 0; i < 4; i++) await send(fake, c, i % 2 === 0);
    expect(writes(fake, once), "settled once").toEqual([]);
    expect(tallyPosts(fake, after).filter((p) => p.at.startsWith(D)), "D not touched (Together already had the final answer)").toEqual([]);
  });

  it("in the gap: a private tick on this device still hides a day already sent with answers, and stays hidden after the pull", async () => {
    const { c, fake, server, file, D } = await replaceSetUp();
    await stopSyncing(db);
    await restoreBackup(file, "replace");
    await saveSharePrivate(jk, D, "exercise", true);
    await saveSharePrivate(jk, D, "checkin", true);
    await send(fake, c, true);
    expect((await liveNotes(fake, "exercise"))[D]).toBe(TITLE);
    expect((await liveNotes(fake, "checkin"))[D]).toBe(PROMPTS[0]!.text);
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
    expect(fake.liveTallies(await habit("exercise"))).toEqual([]);
    expect(fake.liveTallies(await habit("checkin"))).toEqual([]);
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
    expect((await liveNotes(fake))[D], "set-up").toBe(`${TITLE}\nPretend Lindisfarne exercise answer`);
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
      afterThePull: tallyPosts(fake, from).map((p) => `${p.at.slice(0, 10)} ${String(p.note).split("\n").pop()}`),
      liveAfter: await liveNotes(fake),
    }, "D removed from Together in the gap (a journal that simply hasn't pulled yet), then inserted again after the pull").toEqual({
      inTheGap: [],
      afterThePull: [],
      liveAfter: { [D]: `${TITLE}\nPretend Lindisfarne exercise answer` },
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
    expect((await liveNotes(fake))[D]).toBe(TITLE);
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
    expect((await liveNotes(fake))[D]).toBe(`${TITLE}\nPretend Mardale exercise answer`);
    expect(tallyPosts(fake, from).filter((p) => /Mardale/.test(String(p.note)))).toHaveLength(1);
  });

  it("a second Replace after the first hold ended holds again; a Replace while signed out of Together (Stop, not removing) is still noticed after signing in again", async () => {
    const { c, fake, file, E } = await replaceSetUp();
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
    expect(tallyPosts(fake, from).filter((p) => /answer/.test(String(p.note)))).toEqual([]);
    void E;
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
    expect((await liveNotes(fake))[D]).toBe(`${TITLE}\nPretend Gildersleeve first answer`);
  });
});

