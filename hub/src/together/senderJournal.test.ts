import { db } from "../data/db";
import {
  cardRef, ensureCheckinSet, importExerciseCards, saveAnswer, saveExerciseDraft, saveExerciseMark, saveSharePrivate, submitExerciseEntry,
} from "../data/repo";
import { parseCardFile } from "../journal/exercise";
import { journalAad, sealJson } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { FAKE_CARD_FILE_CHECKLIST, PRETEND_FEATURES } from "../test/exerciseCards";
import { togetherId } from "./ids";
import { ANSWERS_DELAY_MS, HABIT_TITLES } from "./sender";
import { readSent } from "./store";
import { clock, DEVICE, emptyDb, highlightOn, journalDay, ME, restCalls, send, signedIn } from "./testKit";

// The Mental health exercise and Daily check-in days, against the fake Together server: titles
// at the 3am day change, answers ANSWERS_DELAY_MS later unless private. Made-up cards and words.

const DAY = "2026-11-04";
const SIGN_IN = `${DAY}T10:00:00`;
const TITLES_AT = "2026-11-05T03:30:00"; // the day has ended
const ANSWERS_AT = "2026-11-06T03:30:00"; // and 24 hours more have passed
const TITLE = "Pretend first workbook · Day 1 · Pretend first-book one";

beforeEach(emptyDb);

const habit = (kind: "exercise" | "checkin") => togetherId("habit", kind, 1);
const tally = async (fake: { events: Map<string, Record<string, unknown>> }, kind: string, v: number, day = DAY) =>
  fake.events.get(await togetherId("tally", `${kind}:${day}`, v));
const wire = (fake: { requests: { body: string }[] }) => JSON.stringify(fake.requests);

it("the delay is 24 hours after the day ends", () => {
  expect(ANSWERS_DELAY_MS).toBe(24 * 3_600_000);
});

it("nothing goes before the 3am day change", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay(DAY);
  c.set(`${DAY}T23:30:00`);
  await send(fake, c);
  c.set("2026-11-05T02:30:00"); // still her Nov 4
  await send(fake, c);
  expect(fake.events.size).toBe(0);
});

it("at the day change: two habits (day, 1, 0/0) and titles-only tallies; no answer anywhere", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { q1, q2 } = await journalDay(DAY, { exercise: true, checkin: true, learned: "Pretend learned words" });
  c.set(TITLES_AT);
  expect(await send(fake, c)).toMatchObject({ kind: "ok", refused: 0 });
  for (const kind of ["exercise", "checkin"] as const) {
    expect(fake.todos.get(await habit(kind))).toMatchObject({
      type: "habit", period: "day", target: 1, points_earn: 0, points_miss: 0, owner_id: ME, created_by: ME, title: HABIT_TITLES[kind], tally: 1,
    });
  }
  expect(await tally(fake, "exercise", 1)).toMatchObject({ kind: "tally", user_id: ME, at: `${DAY}T12:00:00.000Z`, note: TITLE });
  expect((await tally(fake, "checkin", 1))!.note).toBe(q1.text);
  expect(wire(fake)).not.toMatch(/Pretend exercise answer|Pretend check-in answer|Pretend learned words/);
  expect(wire(fake)).not.toContain(q2.text.slice(0, 30)); // a skipped question isn't one she answered
});

it("24 hours later: her answers (with the prompts) replace the titles; what she learned never goes (v1)", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { q1 } = await journalDay(DAY, { exercise: true, checkin: true, learned: "Pretend learned words" });
  c.set(TITLES_AT);
  await send(fake, c);
  c.set("2026-11-06T02:30:00"); // not yet 24 hours after the day ended
  await send(fake, c);
  expect((await tally(fake, "exercise", 2))).toBeUndefined();
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect((await tally(fake, "exercise", 1))!.deleted_at).not.toBeNull();
  expect((await tally(fake, "exercise", 2))!.note).toBe(`${TITLE}\nPretend exercise answer`);
  expect(wire(fake)).not.toMatch(/Pretend learned words|What I learned/);
  expect((await tally(fake, "checkin", 2))!.note).toBe(`${q1.text}\nPretend check-in answer`);
  expect(fake.liveTallies(await habit("exercise"))).toHaveLength(1);
  expect(fake.todos.get(await habit("exercise"))!.tally).toBe(1);
  // What stays behind, hidden, is titles only.
  expect((await tally(fake, "exercise", 1))!.note).toBe(TITLE);
});

it("ticked private before the day ended: the answers never go", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { exercise: true, checkin: true, learned: "Pretend learned words" });
  await saveSharePrivate(jk, DAY, "exercise", true);
  await saveSharePrivate(jk, DAY, "checkin", true);
  for (const at of [TITLES_AT, ANSWERS_AT, "2026-11-10T09:00:00"]) {
    c.set(at);
    await send(fake, c);
  }
  expect(wire(fake)).not.toMatch(/Pretend exercise answer|Pretend check-in answer|Pretend learned words/);
  expect((await tally(fake, "exercise", 1))!.note).toBe(TITLE);
  expect((await tally(fake, "exercise", 2))).toBeUndefined();
});

it("a tick from another device that arrives after the titles went (the race): the answers never go", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { checkin: true });
  c.set(TITLES_AT);
  await send(fake, c); // the Mac sends titles; the phone's tick hasn't synced yet
  const id = `share:${DAY}:checkin`; // the phone's tick arrives by sync later that morning
  await db.journal.put({ id, kind: "share", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, private: true, at: 1 }, journalAad(id))) });
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect(wire(fake)).not.toContain("Pretend check-in answer");
});

it("ticked private after the answers went: the answers tally deleted (its text stays, hidden), titles in its place", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, q1 } = await journalDay(DAY, { checkin: true });
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect((await tally(fake, "checkin", 1))!.note).toContain("Pretend check-in answer");
  await saveSharePrivate(jk, DAY, "checkin", true);
  await send(fake, c);
  expect((await tally(fake, "checkin", 1))!.deleted_at).not.toBeNull();
  expect((await tally(fake, "checkin", 1))!.note).toContain("Pretend check-in answer"); // Together's rule: hidden, not wiped
  expect(await tally(fake, "checkin", 2)).toMatchObject({ note: q1.text, deleted_at: null });
  expect(fake.todos.get(await habit("checkin"))!.tally).toBe(1);
});

it("a taken id with unknown content (a reply lost, then ticked private) is deleted, never counted as sent", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, q1 } = await journalDay(DAY, { checkin: true });
  c.set(TITLES_AT);
  await send(fake, c); // v1: the question only
  c.set(ANSWERS_AT);
  // v2, with her answer, reaches Together, but the reply is lost on the way back.
  fake.inject({ lostReply: true, when: (r) => r.method === "POST" && r.body.includes("Pretend check-in answer") });
  expect(await send(fake, c)).toEqual({ kind: "offline" });
  expect((await tally(fake, "checkin", 2))!.note).toContain("Pretend check-in answer");
  await saveSharePrivate(jk, DAY, "checkin", true);
  expect(await send(fake, c)).toMatchObject({ kind: "ok", refused: 0 });
  expect((await tally(fake, "checkin", 2))!.deleted_at).not.toBeNull();
  expect(fake.liveTallies(await habit("checkin")).map((e) => e.note)).toEqual([q1.text]);
  expect(fake.todos.get(await habit("checkin"))!.tally).toBe(1);
});

it("an edited answer after it went: a new version; nothing changed: nothing sent", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, q1 } = await journalDay(DAY, { checkin: true });
  c.set(ANSWERS_AT);
  await send(fake, c);
  const n = restCalls(fake).length;
  expect(await send(fake, c)).toMatchObject({ kind: "ok", sent: 0 });
  expect(restCalls(fake).length).toBe(n);
  await saveAnswer(jk, DAY, q1.id, DEVICE, "Pretend edited answer", true, { session: "1" });
  await send(fake, c);
  expect((await tally(fake, "checkin", 2))!.note).toContain("Pretend edited answer");
  expect(fake.liveTallies(await habit("checkin"))).toHaveLength(1);
});

it("a draft never goes (not even one typed after submitting); an unfinished check-in doesn't count", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, card, q1, q2 } = await journalDay(DAY, { exercise: true });
  await saveExerciseDraft(jk, DAY, DEVICE, cardRef(card), "Pretend later draft");
  await ensureCheckinSet(jk, DAY, [q1.id, q2.id]);
  await saveAnswer(jk, DAY, q1.id, DEVICE, "Pretend half-done check-in", true);
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect((await tally(fake, "exercise", 1))!.note).toContain("Pretend exercise answer");
  expect(await tally(fake, "checkin", 1)).toBeUndefined();
  expect(wire(fake)).not.toMatch(/Pretend later draft|Pretend half-done/);
});

it("a card's answers go with the prompts and checklist items they answer", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const jk = await keyFor("fake-journal-together");
  await confirmedDevice(db, jk);
  const set = parseCardFile(JSON.stringify(FAKE_CARD_FILE_CHECKLIST))!;
  await importExerciseCards(jk, set, DAY);
  const card = set.cards[0]!;
  const rows = PRETEND_FEATURES.map((f, i) => [f, i === 1 ? "Partly" : "Yes", i === 0 ? "Pretend note of mine" : ""]);
  await submitExerciseEntry(jk, DAY, DEVICE, cardRef(card), [{ prompt: card.parts[0]!.prompt, kind: "checklist", answer: rows }]);
  c.set(ANSWERS_AT);
  await send(fake, c);
  const note = String((await tally(fake, "exercise", 1))!.note);
  expect(note).toContain(card.parts[0]!.prompt);
  expect(note).toContain(`${PRETEND_FEATURES[0]}: Yes (Pretend note of mine)`);
  expect(note).toContain(`${PRETEND_FEATURES[1]}: Partly`);
});

it("what she learned goes only with an exercise day", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay(DAY, { learned: "Pretend learned on a day without a card" });
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect(wire(fake)).not.toContain("Pretend learned on a day without a card");
});

it("a day un-ticked after it went: its tally deleted, the count follows", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, card } = await journalDay(DAY, { exercise: true });
  c.set(TITLES_AT);
  await send(fake, c);
  await saveExerciseMark(jk, DAY, DEVICE, card.id, false);
  await send(fake, c);
  expect((await tally(fake, "exercise", 1))!.deleted_at).not.toBeNull();
  expect(fake.todos.get(await habit("exercise"))!.tally).toBe(0);
});

it("days before copying started never go", async () => {
  const c = clock(SIGN_IN);
  await journalDay("2026-11-01", { exercise: true, checkin: true });
  const fake = await signedIn(c);
  c.set("2026-11-08T09:00:00");
  await send(fake, c);
  expect(wire(fake)).not.toMatch(/2026-11-01|Pretend exercise answer/);
  expect(fake.events.size).toBe(0);
});

it("journal locked on this device: no habits, no tallies, and nothing already sent is touched", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay(DAY);
  c.set(TITLES_AT);
  await send(fake, c);
  await db.syncMeta.delete("journalKey");
  const n = restCalls(fake).length;
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect(restCalls(fake).length).toBe(n);
  expect(fake.liveTallies(await habit("exercise"))).toHaveLength(1);
});

it("a refused delete is set aside as \"couldn't be hidden\", not \"couldn't be copied\"", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { checkin: true });
  c.set(ANSWERS_AT);
  await send(fake, c);
  await saveSharePrivate(jk, DAY, "checkin", true);
  fake.inject({ status: 403, body: { code: "42501" }, when: (r) => r.method === "PATCH" && r.url.includes("todo_events") });
  expect(await send(fake, c)).toMatchObject({ kind: "ok", refused: 1 });
  expect(Object.values((await readSent(db))!.refused)).toEqual([expect.objectContaining({ what: "hide" })]);
  expect(await send(fake, c, true)).toMatchObject({ kind: "ok", refused: 0 }); // Send now tries again
  expect((await tally(fake, "checkin", 1))!.deleted_at).not.toBeNull();
});

describe("tallies that may be in Together (bug #49)", () => {
  it("is written down before the insert goes, and forgotten once the insert is confirmed", async () => {
    const c = clock(SIGN_IN);
    const fake = await signedIn(c);
    await journalDay(DAY, { checkin: true });
    c.set(TITLES_AT);
    let seenBefore: unknown = null;
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST" && String(input).includes("todo_events")) seenBefore = { ...(await readSent(db))!.maybe };
      return fake.fetch(input, init);
    }) as typeof fetch;
    const { sendToTogether } = await import("./sender");
    expect(await sendToTogether({ fetch: f, now: c.now })).toMatchObject({ kind: "ok" });
    expect(seenBefore).toEqual({ [await togetherId("tally", `checkin:${DAY}`, 1)]: { key: `checkin:${DAY}`, v: 1 } });
    expect((await readSent(db))!.maybe).toEqual({});
  });

  it("a cut-off insert is deleted before anything new goes; one that never reached Together is just forgotten", async () => {
    const c = clock(SIGN_IN);
    const fake = await signedIn(c);
    await journalDay(DAY, { checkin: true });
    c.set(TITLES_AT);
    fake.inject({ networkError: true, when: (r) => r.method === "POST" && r.url.includes("todo_events") }); // never reached Together
    expect(await send(fake, c)).toEqual({ kind: "offline" });
    expect(Object.keys((await readSent(db))!.maybe!)).toHaveLength(1);
    const n = fake.requests.length;
    expect(await send(fake, c)).toMatchObject({ kind: "ok" });
    const after = fake.requests.slice(n);
    expect(after[0]!.method).toBe("PATCH"); // the cleanup comes first
    expect((await readSent(db))!.maybe).toEqual({});
    expect(fake.liveTallies(await habit("checkin"))).toHaveLength(1);
  });

  it("a cleanup Together refuses: nothing new goes, and it's shown as not yet hidden", async () => {
    const c = clock(SIGN_IN);
    const fake = await signedIn(c);
    await journalDay(DAY, { checkin: true });
    c.set(TITLES_AT);
    fake.inject({ lostReply: true, when: (r) => r.method === "POST" && r.url.includes("todo_events") });
    expect(await send(fake, c)).toEqual({ kind: "offline" });
    fake.inject({ status: 403, body: { code: "42501" }, when: (r) => r.method === "PATCH" });
    const n = fake.requests.length;
    expect(await send(fake, c)).toMatchObject({ kind: "ok", refused: 1 });
    expect(fake.requests.slice(n).filter((r) => r.method === "POST")).toHaveLength(0);
    expect((await readSent(db))!.refused.maybe).toMatchObject({ what: "hide" });
    expect(await send(fake, c, true)).toMatchObject({ kind: "ok", refused: 0 });
    expect(fake.liveTallies(await habit("checkin"))).toHaveLength(1);
  });
});

describe("Together v1 (Esme, 2026-11-06): highlights never go", () => {
  it("a day's highlights (passage and note) never go: not at 3am, not with the answers, not another day's", async () => {
    const c = clock(SIGN_IN);
    const fake = await signedIn(c);
    await journalDay(DAY, { exercise: true });
    await highlightOn(DAY, "pretend Wrenfold clouds", "Pretend Wrenfold note");
    await highlightOn("2026-11-03", "pretend Pellmoor yesterday");
    for (const at of [TITLES_AT, ANSWERS_AT, "2026-11-10T09:00:00"]) {
      c.set(at);
      await send(fake, c);
    }
    expect((await tally(fake, "exercise", 2))!.note).toBe(`${TITLE}\nPretend exercise answer`);
    expect(wire(fake)).not.toMatch(/Wrenfold|Pellmoor|Highlighted learnings/);
  });
});


it("bug #59: a whole kind that can't be read (the card file won't open here): a day ticked private is still hidden", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { exercise: true });
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect(String((await tally(fake, "exercise", 1))!.note)).toContain("Pretend exercise answer");
  const other = await keyFor("fake-journal-some-other-key");
  const cards = (await db.journal.get("cards"))!;
  await db.journal.put({ ...cards, fp: other.fp, ...(await sealJson(other.key, { v: 1 }, journalAad("cards"))) });
  await saveSharePrivate(jk, DAY, "exercise", true);
  await send(fake, c);
  const live = fake.liveTallies(await habit("exercise"));
  expect(live).toHaveLength(1);
  expect(String(live[0]!.note ?? "")).not.toContain("Pretend exercise answer");
});
