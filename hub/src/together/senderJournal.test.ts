import { db } from "../data/db";
import {
  cardRef, ensureCheckinSet, importExerciseCards, saveAnswer, saveExerciseDraft, saveExerciseMark, saveSharePrivate, submitExerciseEntry,
} from "../data/repo";
import { parseCardFile } from "../journal/exercise";
import { journalAad, sealJson } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { FAKE_CARD_FILE_CHECKLIST, PRETEND_FEATURES } from "../test/exerciseCards";
import type { FakeSupabase } from "./fakeSupabase";
import { togetherId } from "./ids";
import { CHALLENGE_NAME, sendToTogether } from "./sender";
import { readSent } from "./store";
import {
  CHALLENGE, clock, COUPLE, dayRow, dayWrites, DEVICE, emptyDb, highlightOn, journalDay, liveDays, liveNote, ME, PARTNER, PARTNER_CHALLENGE,
  restCalls, send, signedIn, type Clock,
} from "./testKit";

// The Mental health exercise and Daily check-in days, logged in her "Mental Health Work"
// challenge against the fake Together server: one row per day. Sending is manual (Esme,
// 2026-11-09): "Send now" (`send`) sends every day up to today at once, answers too, unless
// private; the automatic runs (`hide`) only take words out. Made-up cards and words.

const DAY = "2026-11-04";
const SIGN_IN = `${DAY}T10:00:00`;
const LATER = "2026-11-05T09:00:00";
const TITLE = "Pretend first workbook · Day 1 · Pretend first-book one";

beforeEach(emptyDb);

const wire = (fake: { requests: { body: string; url: string }[] }) => JSON.stringify(fake.requests);
/** An automatic run (after a sync, on opening): only takes words out. */
const hide = (fake: FakeSupabase, c: Clock) => sendToTogether({ fetch: fake.fetch, now: c.now, mode: "hide" });

it("nothing goes without a press: automatic runs that day and after write nothing", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay(DAY);
  for (const at of [`${DAY}T23:30:00`, "2026-11-05T03:30:00", "2026-11-07T03:30:00"]) {
    c.set(at);
    await hide(fake, c);
  }
  expect(fake.days.size).toBe(0);
  expect(fake.requests.filter((r) => r.url.includes("/rest/v1/challenges"))).toEqual([]);
});

it("her challenge is found by name on the first press, renamed once to Mental Health Work; Oliver's is never touched", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay(DAY);
  expect(await send(fake, c)).toMatchObject({ kind: "ok", refused: 0 });
  expect(fake.challenges.get(CHALLENGE)!.name).toBe(CHALLENGE_NAME);
  expect(fake.challenges.get(PARTNER_CHALLENGE)!.name).toBe("Pretend partner challenge");
  expect(fake.liveDays(PARTNER_CHALLENGE)).toEqual([]);
  expect((await readSent(db))!.challenge).toEqual({ id: CHALLENGE, renamed: true });
  c.set(LATER);
  await send(fake, c);
  const renames = fake.requests.filter((r) => r.url.includes("/rest/v1/challenges") && r.method === "PATCH");
  expect(renames).toHaveLength(1);
  expect(JSON.parse(renames[0]!.body)).toEqual({ name: CHALLENGE_NAME });
  expect(renames[0]!.url).toContain(`couple_id=eq.${COUPLE}`);
  // Looked up once, by her couple only.
  expect(fake.requests.filter((r) => r.url.includes("/rest/v1/challenges") && r.method === "GET")).toHaveLength(1);
});

it("found under its new name or its id too; no such challenge: nothing goes, and the record says so", async () => {
  for (const [name, id, forUser] of [
    ["  mental health WORK ", "pretend-renamed", ME],
    ["Pretend other name", "bpd-research", ME],
    ["BPD research", "bpd-research", null], // its known id, for no one in particular
  ] as const) {
    await emptyDb();
    const c = clock(SIGN_IN);
    const fake = await signedIn(c);
    fake.challenges.delete(CHALLENGE);
    fake.addChallenge({ id, couple_id: COUPLE, name, for_user: forUser });
    await journalDay(DAY);
    await send(fake, c);
    expect(fake.liveDays(id)).toHaveLength(1);
  }
  await emptyDb();
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  fake.challenges.delete(CHALLENGE);
  fake.addChallenge({ id: "pretend-olivers", couple_id: COUPLE, name: "BPD research", for_user: PARTNER }); // his, never hers
  await journalDay(DAY);
  expect(await send(fake, c)).toMatchObject({ kind: "ok" });
  expect(fake.days.size).toBe(0);
  expect(fake.challenges.get("pretend-olivers")!.name).toBe("BPD research");
  expect((await readSent(db))!.challengeMissing).toBe(true);
  // Once it is there, the next press finds it.
  fake.addChallenge({ id: CHALLENGE, couple_id: COUPLE, name: "BPD research", for_user: ME });
  await send(fake, c);
  expect(liveDays(fake)).toHaveLength(1);
  expect((await readSent(db))!.challengeMissing).toBeUndefined();
});

it("a press: one row for the day (both parts), with her answers and research notes at once, the same day", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { q1, q2 } = await journalDay(DAY, { exercise: true, checkin: true, learned: "Pretend learned words\n\nPretend second line" });
  expect(await send(fake, c)).toMatchObject({ kind: "ok", refused: 0 });
  expect(liveDays(fake)).toHaveLength(1);
  expect(dayRow(fake, DAY)).toMatchObject({
    id: await togetherId("day", `${CHALLENGE}:${DAY}`, 1), couple_id: COUPLE, challenge_id: CHALLENGE, day: DAY, by: ME, deleted_at: null,
    note: `1 exercise · Check In\n\n## Mental Health Exercise\n\n## Research notes\n• Pretend learned words\n• Pretend second line\n\n### ${TITLE}\nPretend exercise answer\n\n## Check In\n**${q1.text}**\nPretend check-in answer`,
  });
  expect(dayWrites(fake).map((r) => r.method)).toEqual(["POST"]);
  expect(wire(fake)).not.toContain(q2.text.slice(0, 30)); // a skipped question isn't one she answered
});

it("ticked private before the press: the answers and research notes never go (titles and questions only)", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, q1 } = await journalDay(DAY, { exercise: true, checkin: true, learned: "Pretend learned words" });
  await highlightOn(DAY, "pretend Wrenfold clouds", "Pretend Wrenfold note");
  await saveSharePrivate(jk, DAY, "exercise", true);
  await saveSharePrivate(jk, DAY, "checkin", true);
  for (const at of [SIGN_IN, LATER, "2026-11-10T09:00:00"]) {
    c.set(at);
    await send(fake, c);
    await hide(fake, c);
  }
  expect(wire(fake)).not.toMatch(/Pretend exercise answer|Pretend check-in answer|Pretend learned words|Wrenfold/);
  expect(liveNote(fake, DAY)).toBe(`1 exercise · Check In\n\n## Mental Health Exercise\n\n### ${TITLE}\n\n## Check In\n**${q1.text}**`);
});

it("one part private: only the other part's answers go", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, q1 } = await journalDay(DAY, { exercise: true, checkin: true, learned: "Pretend learned words" });
  await saveSharePrivate(jk, DAY, "exercise", true);
  await send(fake, c);
  expect(liveNote(fake, DAY)).toBe(`1 exercise · Check In\n\n## Mental Health Exercise\n\n### ${TITLE}\n\n## Check In\n**${q1.text}**\nPretend check-in answer`);
});

it("a tick from another device that arrives before the press (the race): the answers never go", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { checkin: true });
  await hide(fake, c); // an automatic run before the phone's tick has synced: nothing goes
  const id = `share:${DAY}:checkin`; // the phone's tick arrives by sync
  await db.journal.put({ id, kind: "share", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, private: true, at: 1 }, journalAad(id))) });
  await send(fake, c);
  expect(wire(fake)).not.toContain("Pretend check-in answer");
});

it("ticked private after the answers went: the next automatic run overwrites the note with titles only (really replaced)", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, q1 } = await journalDay(DAY, { checkin: true, exercise: true, learned: "Pretend learned words" });
  await send(fake, c);
  expect(liveNote(fake, DAY)).toContain("Pretend check-in answer");
  await saveSharePrivate(jk, DAY, "checkin", true);
  await saveSharePrivate(jk, DAY, "exercise", true);
  await hide(fake, c); // no press needed
  expect(fake.days.size).toBe(1);
  expect(dayRow(fake, DAY)).toMatchObject({ note: `1 exercise · Check In\n\n## Mental Health Exercise\n\n### ${TITLE}\n\n## Check In\n**${q1.text}**`, deleted_at: null });
  expect(JSON.stringify([...fake.days.values()])).not.toMatch(/Pretend check-in answer|Pretend exercise answer|Pretend learned words/);
});

it("an insert whose reply was lost, then ticked private: the next automatic run overwrites the row, never leaving answers", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, q1 } = await journalDay(DAY, { checkin: true });
  fake.inject({ lostReply: true, when: (r) => r.method === "POST" && r.body.includes("Pretend check-in answer") });
  expect(await send(fake, c)).toEqual({ kind: "offline" });
  expect(liveNote(fake, DAY)).toContain("Pretend check-in answer");
  expect((await readSent(db))!.days![DAY]).toMatchObject({ hash: "", live: true });
  await saveSharePrivate(jk, DAY, "checkin", true);
  expect(await hide(fake, c)).toMatchObject({ kind: "ok", refused: 0 });
  expect(liveNote(fake, DAY)).toBe(`Check In\n\n## Check In\n**${q1.text}**`);
  expect(fake.days.size).toBe(1);
});

it("an insert that never reached Together is inserted on the next press (an automatic run never inserts)", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay(DAY, { checkin: true });
  fake.inject({ networkError: true, when: (r) => r.method === "POST" && r.url.includes("challenge_days") });
  expect(await send(fake, c)).toEqual({ kind: "offline" });
  expect(fake.days.size).toBe(0);
  await hide(fake, c);
  expect(fake.days.size).toBe(0);
  expect(await send(fake, c)).toMatchObject({ kind: "ok", refused: 0 });
  expect(liveDays(fake)).toHaveLength(1);
});

it("an edited answer after it went: overwritten on the next press, never by an automatic run; nothing changed: nothing sent (a replay sends nothing)", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, q1 } = await journalDay(DAY, { checkin: true });
  await send(fake, c);
  const n = restCalls(fake).length;
  expect(await send(fake, c)).toMatchObject({ kind: "ok", sent: 0 });
  expect(restCalls(fake).filter((r) => r.method !== "GET").length).toBe(restCalls(fake).slice(0, n).filter((r) => r.method !== "GET").length);
  await saveAnswer(jk, DAY, q1.id, DEVICE, "Pretend edited answer", true, { session: "1" });
  await hide(fake, c);
  expect(liveNote(fake, DAY)).not.toContain("Pretend edited answer");
  await send(fake, c);
  expect(liveNote(fake, DAY)).toContain("Pretend edited answer");
  expect(liveNote(fake, DAY)).not.toContain("Pretend check-in answer");
  expect(fake.days.size).toBe(1);
});

it("a draft never goes (not even one typed after submitting); an unfinished check-in doesn't count", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, card, q1, q2 } = await journalDay(DAY, { exercise: true });
  await saveExerciseDraft(jk, DAY, DEVICE, cardRef(card), "Pretend later draft");
  await ensureCheckinSet(jk, DAY, [q1.id, q2.id]);
  await saveAnswer(jk, DAY, q1.id, DEVICE, "Pretend half-done check-in", true);
  await send(fake, c);
  expect(liveNote(fake, DAY)).toBe(`1 exercise\n\n## Mental Health Exercise\n\n### ${TITLE}\nPretend exercise answer`);
  expect(wire(fake)).not.toMatch(/Pretend later draft|Pretend half-done|Check In/);
});

it("a card's answers go as bold prompts with her answer below, checklist items included; private: the questions only", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const jk = await keyFor("fake-journal-together");
  await confirmedDevice(db, jk);
  const set = parseCardFile(JSON.stringify(FAKE_CARD_FILE_CHECKLIST))!;
  await importExerciseCards(jk, set, DAY);
  const card = set.cards[0]!;
  const rows = PRETEND_FEATURES.map((f, i) => [f, i === 1 ? "Partly" : "Yes", i === 0 ? "Pretend note of mine" : ""]);
  await submitExerciseEntry(jk, DAY, DEVICE, cardRef(card), [{ prompt: card.parts[0]!.prompt, kind: "checklist", answer: rows }]);
  await saveSharePrivate(jk, DAY, "exercise", true);
  await send(fake, c);
  expect(liveNote(fake, DAY)).toContain(`**${card.parts[0]!.prompt}**`); // the question goes with the titles
  expect(liveNote(fake, DAY)).not.toContain("Pretend note of mine");
  await saveSharePrivate(jk, DAY, "exercise", false);
  await send(fake, c);
  const note = liveNote(fake, DAY)!;
  expect(note).toContain(`**${card.parts[0]!.prompt}**\n• ${PRETEND_FEATURES[0]}: Yes (Pretend note of mine)`);
  expect(note).toContain(`\n• ${PRETEND_FEATURES[1]}: Partly`);
});

it("an n/a answer is left out with its question; a part with nothing left is left out", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, q1, q2 } = await journalDay(DAY, { exercise: true });
  await ensureCheckinSet(jk, DAY, [q1.id, q2.id]);
  await saveAnswer(jk, DAY, q1.id, DEVICE, " N/A. ", true);
  await saveAnswer(jk, DAY, q2.id, DEVICE, "n.a", true);
  await send(fake, c);
  expect(liveNote(fake, DAY)).toBe(`1 exercise\n\n## Mental Health Exercise\n\n### ${TITLE}\nPretend exercise answer`);
  expect(wire(fake)).not.toContain(q1.text.slice(0, 30));
});

it("what she learned and highlights go only with an exercise day", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay(DAY, { checkin: true, learned: "Pretend learned on a day without a card" });
  await highlightOn(DAY, "pretend Pellmoor hill", "Pretend Pellmoor note");
  await send(fake, c);
  expect(liveNote(fake, DAY)).toMatch(/^Check In\n\n## Check In\n/);
  expect(wire(fake)).not.toMatch(/Pretend learned on a day without a card|Pellmoor/);
});

it("highlights: that day's own, as bullets with her note; a removed one and another day's never go", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay(DAY, { exercise: true, learned: "Pretend learned words" });
  await highlightOn(DAY, "pretend Wrenfold clouds", "Pretend Wrenfold note");
  await new Promise((r) => setTimeout(r, 5));
  await highlightOn(DAY, "pretend Quillby stream");
  await highlightOn(DAY, "pretend Gristlecomb river", "Pretend Gristlecomb note", { removed: true });
  await highlightOn("2026-11-03", "pretend Pellmoor yesterday");
  await send(fake, c);
  expect(liveNote(fake, DAY)).toBe(
    `1 exercise\n\n## Mental Health Exercise\n\n## Research notes\n• Pretend learned words\n• pretend Wrenfold clouds — Pretend Wrenfold note\n• pretend Quillby stream\n\n### ${TITLE}\nPretend exercise answer`,
  );
  expect(wire(fake)).not.toMatch(/Gristlecomb|Pellmoor/);
});

it("a day un-ticked after it went: the next automatic run marks our row deleted; ticked again: the next press shows the same row again", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, card } = await journalDay(DAY, { exercise: true });
  await send(fake, c);
  await saveExerciseMark(jk, DAY, DEVICE, card.id, false);
  await hide(fake, c);
  expect(dayRow(fake, DAY)!.deleted_at).not.toBeNull();
  await saveExerciseMark(jk, DAY, DEVICE, card.id, true);
  await hide(fake, c);
  expect(dayRow(fake, DAY)!.deleted_at).not.toBeNull(); // shown again only by a press
  await send(fake, c);
  expect(fake.days.size).toBe(1);
  expect(dayRow(fake, DAY)).toMatchObject({ deleted_at: null, note: `1 exercise\n\n## Mental Health Exercise\n\n### ${TITLE}\nPretend exercise answer` });
});

it("a day she logged by hand in Together is left exactly as she wrote it, and never tried again", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay(DAY);
  const hers = fake.logByHand({ couple_id: COUPLE, challenge_id: CHALLENGE, day: DAY, note: "Pretend note she typed in Together", by: ME });
  expect(await send(fake, c)).toMatchObject({ kind: "ok", refused: 0 });
  expect(fake.days.size).toBe(1);
  expect(fake.days.get(String(hers.id))!.note).toBe("Pretend note she typed in Together");
  expect((await readSent(db))!.byHand).toEqual({ [DAY]: true });
  const n = dayWrites(fake).length;
  c.set(LATER);
  await send(fake, c);
  await hide(fake, c);
  expect(dayWrites(fake).length).toBe(n);
  expect(fake.days.get(String(hers.id))!.note).toBe("Pretend note she typed in Together");
});

it("journal locked on this device: a press sends nothing, and nothing already sent is touched", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay(DAY);
  await send(fake, c);
  await db.syncMeta.delete("journalKey");
  const n = dayWrites(fake).length;
  c.set(LATER);
  await send(fake, c);
  await hide(fake, c);
  expect(dayWrites(fake).length).toBe(n);
  expect(liveDays(fake)).toHaveLength(1);
});

it("a refused overwrite of a day with answers is set aside as \"couldn't be hidden\", tried again by the next automatic run", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { checkin: true });
  await send(fake, c);
  await saveSharePrivate(jk, DAY, "checkin", true);
  fake.inject({ status: 403, body: { code: "42501" }, when: (r) => r.method === "PATCH" && r.url.includes("challenge_days") });
  expect(await hide(fake, c)).toMatchObject({ kind: "ok", refused: 1 });
  expect(Object.values((await readSent(db))!.refused)).toEqual([expect.objectContaining({ what: "hide" })]);
  expect(await hide(fake, c)).toMatchObject({ kind: "ok", refused: 0 }); // no Send now needed
  expect(liveNote(fake, DAY)).not.toContain("Pretend check-in answer");
});

it("bug #49: a day is written down before its insert goes, and recorded once it is confirmed", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay(DAY, { checkin: true });
  let seenBefore: unknown = null;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST" && String(input).includes("challenge_days")) seenBefore = { ...(await readSent(db))!.days };
    return fake.fetch(input, init);
  }) as typeof fetch;
  expect(await sendToTogether({ fetch: f, now: c.now })).toMatchObject({ kind: "ok" });
  expect(seenBefore).toEqual({ [DAY]: { hash: "", live: true, parts: { exercise: "answers", checkin: "answers" } } });
  expect((await readSent(db))!.days![DAY]).toMatchObject({ live: true, parts: { checkin: "answers" } });
  expect((await readSent(db))!.days![DAY]!.hash).not.toBe("");
});

it("bug #59: a whole part that can't be read (the card file won't open here): a day ticked private is still hidden", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { exercise: true });
  await send(fake, c);
  expect(liveNote(fake, DAY)).toContain("Pretend exercise answer");
  const other = await keyFor("fake-journal-some-other-key");
  const cards = (await db.journal.get("cards"))!;
  await db.journal.put({ ...cards, fp: other.fp, ...(await sealJson(other.key, { v: 1 }, journalAad("cards"))) });
  const n = dayWrites(fake).length;
  await send(fake, c);
  await hide(fake, c);
  expect(dayWrites(fake).length).toBe(n); // not private: left as it is
  await saveSharePrivate(jk, DAY, "exercise", true);
  await hide(fake, c);
  expect(liveDays(fake)).toHaveLength(1);
  expect(liveNote(fake, DAY)).toBe("Mental Health Exercise\n\n## Mental Health Exercise"); // the card file won't open: its heading only
});
