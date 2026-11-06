// TESTING (Life Planner - Together Link Testing): a time-zone-proof version of the recorder in
// neverSent.test.ts ("nothing forbidden is ever sent to Together"). That one fails falsely east of
// UTC+3:30 (Asia/Dubai, Pacific/Kiritimati): the stage-2 delete at local 2026-11-06T03:30 sends
// `deleted_at` = the clock's own instant in UTC, "2026-11-05T23:30:00.000Z", which contains the
// forbidden morning-only date. Not a leak: that's the sending time, not a journal date.
//
// The fix here: the clock's own instant (exactly `new Date(now()).toISOString()`, the only
// timestamp the client makes up) is scrubbed before matching, and every `deleted_at` must be
// exactly that instant or null, so nothing can hide behind the scrub. Everything else is checked
// as before (address as sent and decoded, headers, raw body, every parsed string), plus the
// fixed tally ids a morning-only day would get. Violations are collected, not thrown (the client
// swallows a throw as "offline", review R-M1), and asserted empty at the end.
//
// Proof that it still catches a real leak: the sender's journal reader is swapped (in this file
// only, via vi.mock; no app code changed) for a copy that leaks the morning-only day, as a
// refactor using journalRowDays would, or that leaks morning-page text. Both must be caught in
// every time zone. Run: TZ=Asia/Dubai | Pacific/Kiritimati | America/Los_Angeles | UTC.
// Every word and key here is made up.

import { db } from "../data/db";
import {
  addMorningPhoto, cardRef, ensureCheckinSet, finishMorningPage, saveAnswer, saveExerciseDraft, saveMorningDraft, saveNote,
  saveSharePrivate, setExerciseStar, submitExerciseEntry,
} from "../data/repo";
import { saveSyncSettings } from "../sync/engine";
import { PROMPTS } from "../journal/prompts";
import { togetherId } from "./ids";
import { sendToTogether, signInToTogether, stopTogether } from "./sender";
import { clock, DEVICE, EMAIL, emptyDb, fakeTogether, journalDay, PASSWORD } from "./testKit";

const mode = vi.hoisted(() => ({ leak: "none" as "none" | "morning-date" | "morning-text" }));

vi.mock("./journalNotes", async (importOriginal) => {
  const real = await importOriginal<typeof import("./journalNotes")>();
  return {
    ...real,
    // A deliberately broken COPY of the reader, for the leak proofs only.
    readJournalDays: async (...args: Parameters<typeof real.readJournalDays>) => {
      const days = await real.readJournalDays(...args);
      const [, since, today] = args;
      const morningOnly = "2026-11-05";
      if (mode.leak === "morning-date" && days.checkin && morningOnly >= since && morningOnly < today) {
        days.checkin.notes.set(morningOnly, { titles: "Pretend question", full: "Pretend question" });
      }
      if (mode.leak === "morning-text" && days.exercise) {
        for (const [d, n] of days.exercise.notes) days.exercise.notes.set(d, { titles: n.titles, full: `${n.full}\n\nPretend "morning" page,\nline two` });
      }
      return days;
    },
  };
});

const DAY = "2026-11-04";
const MORNING_ONLY = "2026-11-05"; // a day with only a morning page and photo
const PRIVATE_DAY = "2026-11-06"; // a day ticked private before anything went
const PASS = "fake-journal-and-sync-passphrase";
const SYNC_TOKEN = "5ec7".padEnd(64, "a"); // fake
const JPEG = btoa("pretend-jpeg-bytes-for-a-morning-photo-0123456789");
const MORNING = 'Pretend "morning" page,\nline two with a \\ backslash';
const NOTE = { thought: 'Pretend "hard" thought\nsecond line', steady: "Pretend steady\twords", memory: "Pretend memory\r\nof a day", skill: 'Pretend skill "TIPP"' };
const ISO_INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

/** Every string in a parsed JSON value (keys too), however deep. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.push(k), strings(x, out));
  return out;
}

/**
 * Like testKit's guardedFetch, but time-zone proof: the clock's own instant is scrubbed before
 * matching, and `deleted_at` may only ever be that instant (or null). Collects violations.
 */
function tzProofGuard(inner: typeof fetch, forbidden: () => string[], now: () => number) {
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  const violations: string[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (init.body !== undefined && init.body !== null && typeof init.body !== "string") violations.push("a body the recorder can't read");
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const body = typeof init.body === "string" ? init.body : "";
    seen.push({ url, headers, body });
    const stamp = new Date(now()).toISOString();
    let parsedValue: unknown = null;
    try {
      parsedValue = body ? JSON.parse(body) : null;
    } catch {
      parsedValue = null;
    }
    if (parsedValue && typeof parsedValue === "object" && "deleted_at" in parsedValue) {
      const d = (parsedValue as { deleted_at: unknown }).deleted_at;
      if (d !== null && d !== stamp) violations.push(`deleted_at isn't the sending instant: ${JSON.stringify(d)}`);
    }
    let decoded = url;
    try {
      decoded = decodeURIComponent(url);
    } catch {
      /* keep as sent */
    }
    const scrub = (s: string) => s.split(stamp).join("<now>");
    const places = [url, decoded, JSON.stringify(headers), ...Object.values(headers), body, ...strings(parsedValue)].map(scrub);
    for (const bad of forbidden()) {
      if (bad && places.some((p) => p.includes(bad))) violations.push(`forbidden: ${JSON.stringify(bad.slice(0, 40))} in ${new URL(url).pathname}`);
    }
    return inner(input, init);
  }) as typeof fetch;
  return { fetch: f, seen, violations };
}

beforeEach(async () => {
  mode.leak = "none";
  await emptyDb();
});

async function recorderRun() {
  const c = clock(`${DAY}T09:00:00`);
  const fake = fakeTogether(c);
  const { jk, set, card } = await journalDay(DAY, { exercise: true, checkin: true, learned: "Pretend learned words" });
  await saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: SYNC_TOKEN });
  await db.syncMeta.put({ key: "acceptedToken", value: SYNC_TOKEN });
  await db.items.bulkPut([
    { id: "pretend-todo-1", kind: "task", title: "Pretend shared-looking to-do", notes: "Pretend to-do notes", links: [], areaId: "admin", priority: 2, status: "open", createdAt: DAY, touchedAt: DAY },
    { id: "pretend-todo-2", kind: "task", title: "Pretend Mind to-do", links: [], areaId: "mind", priority: 2, status: "done", completedAt: DAY, createdAt: DAY, touchedAt: DAY },
  ]);
  await saveExerciseDraft(jk, DAY, DEVICE, cardRef(set.cards.find((k) => k.id === "b-002")!), "Pretend exercise draft,\nunsent");
  await setExerciseStar(jk, DAY, DEVICE, card.id, true);
  await saveNote(jk, DAY, DEVICE, { prompt: null, ...NOTE });
  for (const day of [DAY, MORNING_ONLY]) {
    await finishMorningPage(jk, day, DEVICE, `${MORNING} (${day})`);
    await saveMorningDraft(jk, day, DEVICE, "Pretend morning draft\nwords");
    await addMorningPhoto(jk, day, { mime: "image/jpeg", data: JPEG, width: 4, height: 3 });
  }
  await submitExerciseEntry(jk, PRIVATE_DAY, DEVICE, cardRef(card), 'Pretend "private" exercise\nanswer');
  await ensureCheckinSet(jk, PRIVATE_DAY, [PROMPTS[2]!.id]);
  await saveAnswer(jk, PRIVATE_DAY, PROMPTS[2]!.id, DEVICE, "Pretend private check-in\nanswer", true);
  await saveSharePrivate(jk, PRIVATE_DAY, "exercise", true);
  await saveSharePrivate(jk, PRIVATE_DAY, "checkin", true);

  // The ids a morning-only day's tallies would get (hashed, so a plain date scan can't see them).
  const morningIds: string[] = [];
  for (const kind of ["exercise", "checkin"]) for (let v = 1; v <= 8; v++) morningIds.push(await togetherId("tally", `${kind}:${MORNING_ONLY}`, v));

  let signedIn = false;
  const cardFileText = set.cards.filter((k) => k.id !== card.id).flatMap((k) => [k.theme]).concat(
    set.cards.flatMap((k) => [k.learn, k.try, k.more, k.example, k.book]),
  ).filter((s) => s && s.length > 8);
  const forbidden = () => [
    MORNING, "Pretend morning draft", "Pretend \"morning\" page", NOTE.thought, NOTE.steady, NOTE.memory, NOTE.skill, "Pretend hard", "Pretend exercise draft",
    'Pretend "private" exercise', "Pretend private check-in",
    "Pretend shared-looking to-do", "Pretend to-do notes", "Pretend Mind to-do",
    MORNING_ONLY, ...morningIds, JPEG, PASS, jk.fp, SYNC_TOKEN, set.source, ...cardFileText,
    // Together v1 (Esme, 2026-11-06): "what I learned" never goes (core-together, round 8).
    "Pretend learned words", "What I learned",
    ...(signedIn ? [PASSWORD, EMAIL] : []),
  ];
  const guard = tzProofGuard(fake.fetch, forbidden, c.now);
  const env = { fetch: guard.fetch, now: c.now };

  const outcomes: string[] = [];
  expect(await signInToTogether(env, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD })).toEqual({ kind: "ok" });
  signedIn = true;
  for (const at of ["2026-11-04T20:00:00", "2026-11-05T03:30:00", "2026-11-06T03:30:00", "2026-11-07T03:30:00", "2026-11-08T03:30:00", "2026-11-09T09:00:00"]) {
    c.set(at);
    outcomes.push((await sendToTogether(env)).kind);
  }
  await saveSharePrivate(jk, DAY, "exercise", true);
  outcomes.push((await sendToTogether({ ...env, retryRefused: true })).kind);
  outcomes.push((await stopTogether(env, { markDeleted: true })).kind);
  return { guard, fake, outcomes };
}

it("nothing forbidden is ever sent to Together (time-zone proof)", async () => {
  const { guard, fake, outcomes } = await recorderRun();
  expect(guard.violations).toEqual([]);
  expect(outcomes).toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok"]);
  const all = guard.seen.map((r) => r.body).join("\n");
  expect(all).toContain("Pretend exercise answer");
  // Together v1 (Esme, 2026-11-06): "what I learned" never goes (was: it goes with the answers).
  expect(all).not.toContain("Pretend learned words");
  expect(all).toContain("2026-11-06T12:00:00.000Z"); // the private day's titles went
  expect(all).toMatch(/"deleted_at":"\d{4}-/); // deletes did happen (and were checked)
  for (const r of guard.seen) {
    expect(new URL(r.url).origin).toBe(fake.url);
    expect(new URL(r.url).pathname).toMatch(/^\/(auth\/v1\/token|rest\/v1\/(members|todos|todo_events))$/);
    expect(r.headers.apikey).toBe(fake.anonKey);
    if (r.headers.authorization) expect(r.headers.authorization).toMatch(/^Bearer fake-access-\d+$/);
    const b = r.body ? (JSON.parse(r.body) as Record<string, unknown>) : {};
    if (typeof b.deleted_at === "string") expect(b.deleted_at).toMatch(ISO_INSTANT);
  }
  expect([...fake.todos.values()].map((t) => t.type)).toEqual(["habit", "habit"]);
  const withPassword = guard.seen.filter((r) => r.body.includes(PASSWORD));
  expect(withPassword).toHaveLength(1);
  expect(withPassword[0]!.url).toContain("grant_type=password");
});

it("leak proof: a reader that counts the morning-only day as a check-in day is caught (its date)", async () => {
  mode.leak = "morning-date";
  const { guard } = await recorderRun();
  expect(guard.violations.some((v) => v.includes(JSON.stringify(MORNING_ONLY)))).toBe(true);
});

it("leak proof: a reader that adds morning-page text to an exercise note is caught", async () => {
  mode.leak = "morning-text";
  const { guard } = await recorderRun();
  expect(guard.violations.some((v) => v.includes("Pretend \\\"morning\\\" page"))).toBe(true);
});

it("leak proof: the scrub can't hide a journal date smuggled in deleted_at", async () => {
  const c = clock("2026-11-06T03:30:00");
  const fake = fakeTogether(c);
  const guard = tzProofGuard(fake.fetch, () => [MORNING_ONLY], c.now);
  await guard.fetch(`${fake.url}/rest/v1/todo_events?id=eq.x&select=id`, { method: "PATCH", body: JSON.stringify({ deleted_at: `${MORNING_ONLY}T12:00:00.000Z` }) });
  expect(guard.violations.length).toBeGreaterThan(0);
  // ...while the sending instant itself is fine in every time zone.
  const ok = tzProofGuard(fake.fetch, () => [MORNING_ONLY], c.now);
  await ok.fetch(`${fake.url}/rest/v1/todo_events?id=eq.x&select=id`, { method: "PATCH", body: JSON.stringify({ deleted_at: new Date(c.now()).toISOString() }) });
  expect(ok.violations).toEqual([]);
});
