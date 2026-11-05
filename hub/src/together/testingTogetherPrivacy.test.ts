// TESTING (Life Planner - Together Link Testing): privacy timing, the private tick (incl. the C1
// race while a send is in flight) and scope (only exercise and check-in days; never morning
// pages, notes, to-dos, drafts...). Fakes only; every word is a made-up marker. Tests named
// "BUG:" are expected to fail on together-link @2a6edb2.

import { db } from "../data/db";
import {
  addMorningPhoto, cardRef, ensureCheckinSet, finishMorningPage, moveAnswerOn, newNoteId, saveAnswer, saveExerciseDraft,
  saveLearned, saveMorningDraft, saveNote, saveNoteDraft, saveSharePrivate, submitExerciseEntry,
} from "../data/repo";
import { journalAad, sealJson } from "../journal/crypto";
import { PROMPTS } from "../journal/prompts";
import { togetherId } from "./ids";
import { TogetherRunner, type SyncWatch } from "./runner";
import { sendToTogether, stopTogether } from "./sender";
import { clock, DEVICE, emptyDb, journalDay, send, signedIn } from "./testKit";
import type { FakeSupabase } from "./fakeSupabase";

const DAY = "2026-11-04";
const SIGN_IN = `${DAY}T10:00:00`;
const OTHER_DEVICE = "device-pretend-phone-02";

beforeEach(emptyDb);

const habit = (kind: "exercise" | "checkin") => togetherId("habit", kind, 1);
const bodies = (fake: FakeSupabase) => fake.requests.map((r) => r.body).join("\n");

// ---- timing --------------------------------------------------------------------------------

it("titles: not at 02:59:59 after the day, yes at 03:00:00; answers: not at 02:59:59 a day later, yes at 03:00:00", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay(DAY, { exercise: true, checkin: true, learned: "Pretend Copperwhistle" });
  c.set("2026-11-05T02:59:59");
  await send(fake, c);
  expect(fake.events.size).toBe(0);
  c.set("2026-11-05T03:00:00");
  await send(fake, c);
  expect(fake.events.size).toBe(2);
  c.set("2026-11-06T02:59:59");
  await send(fake, c);
  expect(bodies(fake)).not.toMatch(/Pretend exercise answer|Pretend check-in answer|Copperwhistle/);
  c.set("2026-11-06T03:00:00");
  await send(fake, c);
  expect(bodies(fake)).toMatch(/Pretend exercise answer/);
  expect(bodies(fake)).toMatch(/Copperwhistle/);
});

it("a tick one second before the answers are due (after the titles went): the answers never go", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { exercise: true, checkin: true, learned: "Pretend Copperwhistle" });
  c.set("2026-11-05T03:30:00");
  await send(fake, c);
  c.set("2026-11-06T02:59:59");
  await saveSharePrivate(jk, DAY, "exercise", true);
  await saveSharePrivate(jk, DAY, "checkin", true);
  for (const at of ["2026-11-06T03:00:00", "2026-11-07T03:30:00", "2026-11-20T09:00:00"]) {
    c.set(at);
    await send(fake, c);
    await send(fake, c, true);
  }
  expect(bodies(fake)).not.toMatch(/Pretend exercise answer|Pretend check-in answer|Copperwhistle/);
});

it("only the exercise ticked private: the check-in answers still go, the exercise answers and learned words don't", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { exercise: true, checkin: true, learned: "Pretend Copperwhistle" });
  await saveSharePrivate(jk, DAY, "exercise", true);
  c.set("2026-11-06T03:30:00");
  await send(fake, c);
  expect(bodies(fake)).toContain("Pretend check-in answer");
  expect(bodies(fake)).not.toMatch(/Pretend exercise answer|Copperwhistle/);
});

it("un-ticked after being private: the answers go then (and only then)", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { checkin: true });
  await saveSharePrivate(jk, DAY, "checkin", true);
  c.set("2026-11-06T03:30:00");
  await send(fake, c);
  expect(bodies(fake)).not.toContain("Pretend check-in answer");
  await saveSharePrivate(jk, DAY, "checkin", false);
  await send(fake, c);
  expect(fake.liveTallies(await habit("checkin")).map((e) => e.note)).toEqual([expect.stringContaining("Pretend check-in answer")]);
  expect(fake.todos.get(await habit("checkin"))!.tally).toBe(1);
});

// ---- the C1 race, with a send in flight ----------------------------------------------------

/**
 * Stage 2 for DAY's check-in: the titles-only tally is deleted (a PATCH, one round trip to
 * Together), then the answers tally is inserted. `during` runs while that PATCH is on the wire,
 * i.e. after the sender read the tick but before any answer has been sent.
 */
async function stage2WithTickDuringDelete(during: (jk: Awaited<ReturnType<typeof journalDay>>["jk"]) => Promise<void>) {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { checkin: true });
  c.set("2026-11-05T03:30:00");
  await send(fake, c); // titles only
  c.set("2026-11-06T03:30:00");
  let tickedAt = -1;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (tickedAt < 0 && init?.method === "PATCH" && String(input).includes("todo_events")) {
      await during(jk);
      tickedAt = fake.requests.length; // every request from here on was sent after the tick
    }
    return fake.fetch(input, init);
  }) as typeof fetch;
  await sendToTogether({ fetch: f, now: c.now });
  expect(tickedAt).toBeGreaterThan(0);
  return { fake, after: fake.requests.slice(tickedAt).map((r) => r.body).join("\n") };
}

it("BUG: ticked private on this device while the send is in flight, before any answer went: the answers never go", async () => {
  const { after } = await stage2WithTickDuringDelete((jk) => saveSharePrivate(jk, DAY, "checkin", true));
  expect(after).not.toContain("Pretend check-in answer");
});

it("BUG: a tick from the phone arriving by sync while the Mac's send is in flight, before any answer went: the answers never go", async () => {
  const { after } = await stage2WithTickDuringDelete(async (jk) => {
    const id = `share:${DAY}:checkin`;
    await db.journal.put({ id, kind: "share", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, private: true, at: 1 }, journalAad(id))) });
  });
  expect(after).not.toContain("Pretend check-in answer");
});

function fakeSync(): SyncWatch & { finish(): void } {
  let state = { status: "idle", lastSyncedAt: 1 as number | null };
  const fns = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (fn) => (fns.add(fn), () => fns.delete(fn)),
    finish() {
      state = { status: "idle", lastSyncedAt: (state.lastSyncedAt ?? 0) + 1 };
      for (const fn of fns) fn();
    },
  };
}

it("BUG: a tick whose sync finishes while a send is in flight is acted on when that send ends (not only after the next sync)", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { checkin: true });
  c.set("2026-11-05T03:30:00");
  await send(fake, c);
  c.set("2026-11-06T03:30:00");
  const sync = fakeSync();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  let held = false;
  // The answers insert is slow to come back (Together busy).
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fake.fetch(input, init);
    if (!held && init?.method === "POST" && String(init.body).includes("Pretend check-in answer")) {
      held = true;
      await gate;
    }
    return res;
  }) as typeof fetch;
  const runner = new TogetherRunner((o) => sendToTogether({ fetch: f, now: c.now, retryRefused: o.retryRefused }));
  const stop = runner.start(sync);
  sync.finish(); // run 1 starts: sends the answers
  await vi.waitFor(() => expect(held).toBe(true));
  // She ticks private now; saving it syncs at once, and that sync finishes while run 1 is still out.
  await saveSharePrivate(jk, DAY, "checkin", true);
  sync.finish();
  release();
  await vi.waitFor(() => expect(runner.getState().running).toBe(false));
  await new Promise((r) => setTimeout(r, 200));
  await vi.waitFor(() => expect(runner.getState().running).toBe(false));
  stop();
  // No further sync has run. Her just-ticked answers should be hidden by now.
  expect(fake.liveTallies(await habit("checkin")).map((e) => e.note)).not.toEqual([expect.stringContaining("Pretend check-in answer")]);
});

// ---- scope: plant a marker in every part of the app, scan every request -------------------

/** Every string in a parsed JSON value (keys too). */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.push(k), strings(x, out));
  return out;
}

it("scope: no marker from morning pages, notes, drafts, other days, other devices' words, to-dos or goals ever reaches Together", async () => {
  const D1 = DAY; // exercise + check-in + learned (allowed, after the delay)
  const D2 = "2026-11-05"; // morning page only
  const D3 = "2026-11-06"; // learned words without a card; a check-in left half-done
  const D4 = "2026-11-07"; // exercise + check-in + learned, ticked private after its titles went
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, set, card, q1, q2 } = await journalDay(D1, { exercise: false, checkin: false });
  const other = set.cards.find((k) => k.id !== card.id)!;

  // Allowed (positive controls).
  await submitExerciseEntry(jk, D1, DEVICE, cardRef(card), "Pretend Gallowmere answer");
  await ensureCheckinSet(jk, D1, [q1.id, q2.id]);
  await saveAnswer(jk, D1, q1.id, DEVICE, "Pretend Rindlebay answer", true);
  await moveAnswerOn(jk, D1, q2.id, DEVICE, { skip: true });
  await saveLearned(jk, D1, OTHER_DEVICE, "Pretend Fennimore older words"); // another device, older
  await new Promise((r) => setTimeout(r, 5));
  await saveLearned(jk, D1, DEVICE, "Pretend Copperwhistle learned");

  // Never.
  await saveExerciseDraft(jk, D1, DEVICE, cardRef(card), "Pretend Corrimbel draft after submit");
  await saveExerciseDraft(jk, D1, DEVICE, cardRef(other), "Pretend Hollisfen other-card draft");
  for (const [d, w] of [[D1, "Zarnwick"], [D2, "Brumbleaf"]] as const) {
    await finishMorningPage(jk, d, DEVICE, `Pretend ${w} morning page\nsecond "line"`);
    await saveMorningDraft(jk, d, DEVICE, `Pretend ${w}-draft morning draft`);
    await addMorningPhoto(jk, d, { mime: "image/jpeg", data: btoa(`pretend-${w}-jpeg-bytes-0123456789`), width: 4, height: 3 });
  }
  await saveNote(jk, D1, DEVICE, { prompt: q1.id, thought: "Pretend Velmora thought", steady: "Pretend Quintash steady", memory: "Pretend Oxbellow memory", skill: "Pretend Tamsprig skill" });
  await saveNoteDraft(jk, DEVICE, newNoteId(D1), { prompt: null, thought: "Pretend Drevelin draft", steady: "Pretend Drevelin steady", memory: "", skill: "" }, []);
  await saveLearned(jk, D3, DEVICE, "Pretend Ambrelith learned without a card");
  await ensureCheckinSet(jk, D3, [PROMPTS[3]!.id, PROMPTS[4]!.id]);
  await saveAnswer(jk, D3, PROMPTS[3]!.id, DEVICE, "Pretend Mistlewade half-done", true);
  await submitExerciseEntry(jk, D4, DEVICE, cardRef(card), "Pretend Grubbinsk private exercise");
  await ensureCheckinSet(jk, D4, [PROMPTS[5]!.id]);
  await saveAnswer(jk, D4, PROMPTS[5]!.id, DEVICE, "Pretend Pellucor private check-in", true);
  await saveLearned(jk, D4, DEVICE, "Pretend Sorrelind private learned");
  await db.items.bulkPut([
    { id: "pretend-todo-a", kind: "task", title: "Pretend Wobblethorn to-do", notes: "Pretend Kestrigan notes", links: ["https://pindlefax.example.test/x"], tags: ["Pretend Snibbet tag"], areaId: "admin", priority: 2, status: "open", createdAt: D1, touchedAt: D1 },
    { id: "pretend-todo-b", kind: "task", title: "Pretend Murkendale Mind to-do", links: [], areaId: "mind", priority: 1, status: "done", completedAt: D1, createdAt: D1, touchedAt: D1 },
    { id: "pretend-idea-c", kind: "idea", title: "Pretend Snorvelt idea", links: [], areaId: "mind", priority: 3, status: "open", createdAt: D1, touchedAt: D1 },
  ]);
  await db.goals.put({ id: "pretend-goal", title: "Pretend Thistlequorn goal", areaId: "mind", kind: "practice", milestones: [{ id: "pretend-ms", title: "Pretend Quarrendell step", done: false }], createdAt: D1, why: "Pretend Brackenmoor why", notes: "Pretend Grizzlemoot notes" } as never);

  const never = [
    "Corrimbel", "Hollisfen", "Zarnwick", "Brumbleaf", "Velmora", "Quintash", "Oxbellow", "Tamsprig", "Drevelin",
    "Ambrelith", "Mistlewade", "Grubbinsk", "Pellucor", "Sorrelind", "Fennimore",
    "Wobblethorn", "Kestrigan", "pindlefax", "Snibbet", "Murkendale", "Snorvelt", "Thistlequorn", "Brackenmoor", "Grizzlemoot", "Quarrendell",
    `${D2}T12`, `${D3}T12`, ...[...set.cards].filter((k) => k.id !== card.id).map((k) => k.theme).filter((s) => s && s.length > 8),
  ];
  const morningIds: string[] = [];
  for (const d of [D2, D3]) for (const k of ["exercise", "checkin"]) for (let v = 1; v <= 6; v++) morningIds.push(await togetherId("tally", `${k}:${d}`, v));
  const bad: string[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const body = typeof init.body === "string" ? init.body : init.body == null ? "" : "<unreadable body>";
    let parsed: string[] = [];
    try {
      parsed = body ? strings(JSON.parse(body)) : [];
    } catch {
      parsed = [];
    }
    const places = [url, decodeURIComponent(url), JSON.stringify(init.headers ?? {}), body, ...parsed];
    for (const w of [...never, ...morningIds]) if (places.some((p) => p.includes(w))) bad.push(`${w} in ${init.method} ${new URL(url).pathname}`);
    if (body === "<unreadable body>") bad.push("unreadable body");
    return fake.fetch(input, init);
  }) as typeof fetch;
  const env = { fetch: f, now: c.now };

  for (const at of ["2026-11-05T03:30:00", "2026-11-06T03:30:00", "2026-11-07T03:30:00", "2026-11-08T03:30:00"]) {
    c.set(at);
    expect(await sendToTogether(env)).toMatchObject({ kind: "ok" });
  }
  // D4's titles have gone; she ticks it private before its answers are due.
  c.set("2026-11-08T23:00:00");
  await saveSharePrivate(jk, D4, "exercise", true);
  await saveSharePrivate(jk, D4, "checkin", true);
  for (const at of ["2026-11-09T03:30:00", "2026-11-10T09:00:00"]) {
    c.set(at);
    expect(await sendToTogether(env)).toMatchObject({ kind: "ok" });
    expect(await sendToTogether({ ...env, retryRefused: true })).toMatchObject({ kind: "ok" });
  }
  await saveSharePrivate(jk, D1, "exercise", true); // after the answers went: hidden
  await sendToTogether(env);
  expect(await stopTogether(env, { markDeleted: true })).toEqual({ kind: "ok" });

  expect(bad).toEqual([]);
  const all = bodies(fake);
  expect(all).toContain("Pretend Gallowmere answer");
  expect(all).toContain("Pretend Rindlebay answer");
  expect(all).toContain("Pretend Copperwhistle learned");
  expect(all).toContain(`${D4}T12:00:00.000Z`); // D4's titles did go
  expect([...fake.todos.values()].every((t) => t.type === "habit")).toBe(true);
  expect(fake.todos.size).toBe(2);
  for (const e of fake.events.values()) expect(Object.keys(e).sort()).toEqual(["at", "couple_id", "deleted_at", "id", "kind", "note", "todo_id", "updated_at", "user_id"]);
});
