import { db } from "../data/db";
import { exportBackup } from "../data/backup";
import {
  addMorningPhoto, cardRef, ensureCheckinSet, finishMorningPage, saveAnswer, saveExerciseDraft, saveMorningDraft, saveNote,
  saveSharePrivate, setExerciseStar, submitExerciseEntry,
} from "../data/repo";
import { FakeSyncServer } from "../sync/fakeServer";
import { saveSyncSettings, syncOnce } from "../sync/engine";
import { PROMPTS } from "../journal/prompts";
import { sendToTogether, signInToTogether, stopTogether } from "./sender";
import { readAuth, TOGETHER_META, TOGETHER_SENT_META } from "./store";
import { clock, DEVICE, EMAIL, emptyDb, fakeTogether, guardedFetch, journalDay, PASSWORD } from "./testKit";

// The request recorder (Together link brief §5, review I4): every request to Together, from
// sign-in to "Stop", fails the test the moment it holds anything that must never go. Text with
// line breaks, quotes and backslashes is used on purpose. Every word and key here is made up.

const DAY = "2026-11-04";
const MORNING_ONLY = "2026-11-05"; // a day with only a morning page and photo
const PRIVATE_DAY = "2026-11-06"; // a day ticked private before anything went
const PASS = "fake-journal-and-sync-passphrase";
const SYNC_TOKEN = "5ec7".padEnd(64, "a"); // fake
const JPEG = btoa("pretend-jpeg-bytes-for-a-morning-photo-0123456789");
const MORNING = 'Pretend "morning" page,\nline two with a \\ backslash';
const NOTE = { thought: 'Pretend "hard" thought\nsecond line', steady: "Pretend steady\twords", memory: "Pretend memory\r\nof a day", skill: 'Pretend skill "TIPP"' };

beforeEach(emptyDb);

it("nothing forbidden is ever sent to Together", async () => {
  const c = clock(`${DAY}T09:00:00`);
  const fake = fakeTogether(c);
  const { jk, set, card } = await journalDay(DAY, { exercise: true, checkin: true, learned: "Pretend learned words" });
  await saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: SYNC_TOKEN });
  await db.syncMeta.put({ key: "acceptedToken", value: SYNC_TOKEN });

  // Everything else in her app and journal that must never go.
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
  // A day ticked private before anything went.
  await submitExerciseEntry(jk, PRIVATE_DAY, DEVICE, cardRef(card), 'Pretend "private" exercise\nanswer');
  await ensureCheckinSet(jk, PRIVATE_DAY, [PROMPTS[2]!.id]);
  await saveAnswer(jk, PRIVATE_DAY, PROMPTS[2]!.id, DEVICE, "Pretend private check-in\nanswer", true);
  await saveSharePrivate(jk, PRIVATE_DAY, "exercise", true);
  await saveSharePrivate(jk, PRIVATE_DAY, "checkin", true);

  let signedIn = false;
  const cardFileText = set.cards.filter((k) => k.id !== card.id).flatMap((k) => [k.theme]).concat(
    set.cards.flatMap((k) => [k.learn, k.try, k.more, k.example, k.book]),
  ).filter((s) => s && s.length > 8);
  const forbidden = () => [
    MORNING, "Pretend morning draft", NOTE.thought, NOTE.steady, NOTE.memory, NOTE.skill, "Pretend hard", "Pretend exercise draft",
    'Pretend "private" exercise', "Pretend private check-in",
    "Pretend shared-looking to-do", "Pretend to-do notes", "Pretend Mind to-do",
    MORNING_ONLY, JPEG, PASS, jk.fp, SYNC_TOKEN, set.source, ...cardFileText,
    ...(signedIn ? [PASSWORD, EMAIL] : []),
  ];
  const guard = guardedFetch(fake.fetch, forbidden);
  const env = { fetch: guard.fetch, now: c.now };

  expect(await signInToTogether(env, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD })).toEqual({ kind: "ok" });
  signedIn = true;
  for (const at of ["2026-11-04T20:00:00", "2026-11-05T03:30:00", "2026-11-06T03:30:00", "2026-11-07T03:30:00", "2026-11-08T03:30:00", "2026-11-09T09:00:00"]) {
    c.set(at);
    expect(await sendToTogether(env)).toMatchObject({ kind: "ok" });
  }
  await saveSharePrivate(jk, DAY, "exercise", true); // ticked private after the answers went
  expect(await sendToTogether({ ...env, retryRefused: true })).toMatchObject({ kind: "ok" });
  expect(await stopTogether(env, { markDeleted: true })).toEqual({ kind: "ok" });

  // It did send: both days' habits and tallies, DAY's answers and what she learned.
  const all = guard.seen.map((r) => r.body).join("\n");
  expect(all).toContain("Pretend exercise answer");
  expect(all).toContain("Pretend learned words");
  expect(all).toContain("2026-11-06T12:00:00.000Z"); // the private day's titles went
  // Only Together's own endpoints; only habits and tallies; only Together's own tokens.
  for (const r of guard.seen) {
    expect(new URL(r.url).origin).toBe(fake.url);
    expect(new URL(r.url).pathname).toMatch(/^\/(auth\/v1\/token|rest\/v1\/(members|todos|todo_events))$/);
    expect(r.headers.apikey).toBe(fake.anonKey);
    if (r.headers.authorization) expect(r.headers.authorization).toMatch(/^Bearer fake-access-\d+$/);
  }
  expect([...fake.todos.values()].map((t) => t.type)).toEqual(["habit", "habit"]);
  // The password went only in the one sign-in request.
  const withPassword = guard.seen.filter((r) => r.body.includes(PASSWORD));
  expect(withPassword).toHaveLength(1);
  expect(withPassword[0]!.url).toContain("grant_type=password");
});

it("the recorder catches text with line breaks and quotes inside JSON, and refuses bodies it can't read", async () => {
  const c = clock(`${DAY}T09:00:00`);
  const fake = fakeTogether(c);
  const guard = guardedFetch(fake.fetch, () => [MORNING]);
  await expect(guard.fetch(`${fake.url}/rest/v1/todo_events`, { method: "POST", body: JSON.stringify({ note: `x ${MORNING} y` }) })).rejects.toThrow(/FORBIDDEN/);
  await expect(guard.fetch(`${fake.url}/rest/v1/todo_events`, { method: "POST", body: new URLSearchParams({ a: "b" }) })).rejects.toThrow(/FORBIDDEN/);
  const dates = guardedFetch(fake.fetch, () => [MORNING_ONLY]);
  await expect(dates.fetch(`${fake.url}/rest/v1/todo_events?at=eq.${encodeURIComponent(`${MORNING_ONLY}T12:00:00.000Z`)}`, { method: "GET" })).rejects.toThrow(/FORBIDDEN/);
});

it("only this device sends: the Together sign-in and record are never synced and never in a backup", async () => {
  const c = clock(`${DAY}T09:00:00`);
  const fake = fakeTogether(c);
  await journalDay(DAY);
  await signInToTogether({ fetch: fake.fetch, now: c.now }, { url: fake.url, anonKey: fake.anonKey, email: EMAIL, password: PASSWORD });
  c.set("2026-11-05T03:30:00");
  await sendToTogether({ fetch: fake.fetch, now: c.now });
  const auth = (await readAuth(db))!;
  const secrets = [auth.accessToken!, auth.refreshToken!, auth.anonKey, auth.url, auth.coupleId, auth.userId];

  const server = new FakeSyncServer(SYNC_TOKEN);
  await saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: SYNC_TOKEN });
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  const wire = JSON.stringify(server.requests);
  expect(wire).toContain("exercise-entry:"); // sync did run
  for (const s of secrets) expect(wire).not.toContain(s);
  for (const k of [TOGETHER_META, TOGETHER_SENT_META]) expect(wire).not.toContain(`"${k}"`);

  const backup = JSON.stringify(await exportBackup(DAY));
  for (const s of secrets) expect(backup).not.toContain(s);
  expect(backup).not.toContain(TOGETHER_SENT_META);
});
