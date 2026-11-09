import { db } from "../data/db";
import {
  cardRef, ensureCheckinSet, importExerciseCards, saveAnswer, saveExerciseDraft, saveExerciseMark, saveSharePrivate, submitExerciseEntry,
} from "../data/repo";
import { parseCardFile } from "../journal/exercise";
import { journalAad, sealJson } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { FAKE_CARD_FILE_CHECKLIST, PRETEND_FEATURES } from "../test/exerciseCards";
import { togetherId } from "./ids";
import { ANSWERS_DELAY_MS, CHALLENGE_NAME } from "./sender";
import { readSent } from "./store";
import {
  CHALLENGE, clock, COUPLE, dayRow, dayWrites, DEVICE, emptyDb, highlightOn, journalDay, liveDays, liveNote, ME, PARTNER, PARTNER_CHALLENGE,
  restCalls, send, signedIn,
} from "./testKit";

// The Mental health exercise and Daily check-in days, logged in her "Mental Health Work"
// challenge against the fake Together server: one row per day, titles and questions at the 3am
// day change, answers ANSWERS_DELAY_MS later unless private. Made-up cards and words.

const DAY = "2026-11-04";
const SIGN_IN = `${DAY}T10:00:00`;
const TITLES_AT = "2026-11-05T03:30:00"; // the day has ended
const ANSWERS_AT = "2026-11-06T03:30:00"; // and 24 hours more have passed
const TITLE = "Pretend first workbook · Day 1 · Pretend first-book one";

beforeEach(emptyDb);

const wire = (fake: { requests: { body: string; url: string }[] }) => JSON.stringify(fake.requests);

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
  expect(fake.days.size).toBe(0);
});

it("her challenge is found by name, renamed once to Mental Health Work; Oliver's is never touched", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay(DAY);
  c.set(TITLES_AT);
  expect(await send(fake, c)).toMatchObject({ kind: "ok", refused: 0 });
  expect(fake.challenges.get(CHALLENGE)!.name).toBe(CHALLENGE_NAME);
  expect(fake.challenges.get(PARTNER_CHALLENGE)!.name).toBe("Pretend partner challenge");
  expect(fake.liveDays(PARTNER_CHALLENGE)).toEqual([]);
  expect((await readSent(db))!.challenge).toEqual({ id: CHALLENGE, renamed: true });
  c.set(ANSWERS_AT);
  await send(fake, c);
  const renames = fake.requests.filter((r) => r.url.includes("/rest/v1/challenges") && r.method === "PATCH");
  expect(renames).toHaveLength(1);
  expect(JSON.parse(renames[0]!.body)).toEqual({ name: CHALLENGE_NAME });
  expect(renames[0]!.url).toContain(`couple_id=eq.${COUPLE}`);
  // Looked up once, by her couple only.
  expect(fake.requests.filter((r) => r.url.includes("/rest/v1/challenges") && r.method === "GET")).toHaveLength(1);
});

it("found under its new name or its id too; no such challenge: nothing goes, and the record says so", async () => {
  for (const [name, id] of [["  mental health WORK ", "pretend-renamed"], ["Pretend other name", "bpd-research"]] as const) {
    await emptyDb();
    const c = clock(SIGN_IN);
    const fake = await signedIn(c);
    fake.challenges.delete(CHALLENGE);
    fake.addChallenge({ id, couple_id: COUPLE, name, for_user: ME });
    await journalDay(DAY);
    c.set(TITLES_AT);
    await send(fake, c);
    expect(fake.liveDays(id)).toHaveLength(1);
  }
  await emptyDb();
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  fake.challenges.delete(CHALLENGE);
  fake.addChallenge({ id: "pretend-olivers", couple_id: COUPLE, name: "BPD research", for_user: PARTNER }); // his, never hers
  await journalDay(DAY);
  c.set(TITLES_AT);
  expect(await send(fake, c)).toMatchObject({ kind: "ok" });
  expect(fake.days.size).toBe(0);
  expect(fake.challenges.get("pretend-olivers")!.name).toBe("BPD research");
  expect((await readSent(db))!.challengeMissing).toBe(true);
  // Once it is there, the next run finds it.
  fake.addChallenge({ id: CHALLENGE, couple_id: COUPLE, name: "BPD research", for_user: ME });
  await send(fake, c);
  expect(liveDays(fake)).toHaveLength(1);
  expect((await readSent(db))!.challengeMissing).toBeUndefined();
});

it("at the day change: one row for the day (both parts), titles and questions only; no answer anywhere", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { q1, q2 } = await journalDay(DAY, { exercise: true, checkin: true, learned: "Pretend learned words" });
  c.set(TITLES_AT);
  expect(await send(fake, c)).toMatchObject({ kind: "ok", refused: 0 });
  expect(liveDays(fake)).toHaveLength(1);
  expect(dayRow(fake, DAY)).toMatchObject({
    id: await togetherId("day", `${CHALLENGE}:${DAY}`, 1), couple_id: COUPLE, challenge_id: CHALLENGE, day: DAY, by: ME, deleted_at: null,
    note: `Mental Health Exercise\n${TITLE}\n\nCheck In\n**${q1.text}**`,
  });
  expect(wire(fake)).not.toMatch(/Pretend exercise answer|Pretend check-in answer|Pretend learned words|Research notes/);
  expect(wire(fake)).not.toContain(q2.text.slice(0, 30)); // a skipped question isn't one she answered
});

it("24 hours later: the same row's note is overwritten with her answers and research notes", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { q1 } = await journalDay(DAY, { exercise: true, checkin: true, learned: "Pretend learned words\n\nPretend second line" });
  c.set(TITLES_AT);
  await send(fake, c);
  c.set("2026-11-06T02:30:00"); // not yet 24 hours after the day ended
  expect(await send(fake, c)).toMatchObject({ kind: "ok", sent: 0 });
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect(fake.days.size).toBe(1);
  expect(liveNote(fake, DAY)).toBe(
    `Mental Health Exercise\n${TITLE}\n\nResearch notes\n• Pretend learned words\n• Pretend second line\n\nPretend exercise answer\n\nCheck In\n**${q1.text}**\nPretend check-in answer`,
  );
  expect(dayWrites(fake).map((r) => r.method)).toEqual(["POST", "PATCH"]);
});

it("ticked private before the day ended: the answers and research notes never go", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { exercise: true, checkin: true, learned: "Pretend learned words" });
  await highlightOn(DAY, "pretend Wrenfold clouds", "Pretend Wrenfold note");
  await saveSharePrivate(jk, DAY, "exercise", true);
  await saveSharePrivate(jk, DAY, "checkin", true);
  for (const at of [TITLES_AT, ANSWERS_AT, "2026-11-10T09:00:00"]) {
    c.set(at);
    await send(fake, c);
  }
  expect(wire(fake)).not.toMatch(/Pretend exercise answer|Pretend check-in answer|Pretend learned words|Wrenfold/);
  expect(liveNote(fake, DAY)).toContain(TITLE);
});

it("one part private: only the other part's answers go", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, q1 } = await journalDay(DAY, { exercise: true, checkin: true, learned: "Pretend learned words" });
  await saveSharePrivate(jk, DAY, "exercise", true);
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect(liveNote(fake, DAY)).toBe(`Mental Health Exercise\n${TITLE}\n\nCheck In\n**${q1.text}**\nPretend check-in answer`);
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

it("ticked private after the answers went: the note is overwritten with titles only (really replaced)", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, q1 } = await journalDay(DAY, { checkin: true, exercise: true, learned: "Pretend learned words" });
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect(liveNote(fake, DAY)).toContain("Pretend check-in answer");
  await saveSharePrivate(jk, DAY, "checkin", true);
  await saveSharePrivate(jk, DAY, "exercise", true);
  await send(fake, c);
  expect(fake.days.size).toBe(1);
  expect(dayRow(fake, DAY)).toMatchObject({ note: `Mental Health Exercise\n${TITLE}\n\nCheck In\n**${q1.text}**`, deleted_at: null });
  expect(JSON.stringify([...fake.days.values()])).not.toMatch(/Pretend check-in answer|Pretend exercise answer|Pretend learned words/);
});

it("an insert whose reply was lost, then ticked private: the row there is overwritten, never left with answers", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, q1 } = await journalDay(DAY, { checkin: true });
  c.set(ANSWERS_AT);
  fake.inject({ lostReply: true, when: (r) => r.method === "POST" && r.body.includes("Pretend check-in answer") });
  expect(await send(fake, c)).toEqual({ kind: "offline" });
  expect(liveNote(fake, DAY)).toContain("Pretend check-in answer");
  expect((await readSent(db))!.days![DAY]).toMatchObject({ hash: "", live: true });
  await saveSharePrivate(jk, DAY, "checkin", true);
  expect(await send(fake, c)).toMatchObject({ kind: "ok", refused: 0 });
  expect(liveNote(fake, DAY)).toBe(`Check In\n**${q1.text}**`);
  expect(fake.days.size).toBe(1);
});

it("an insert that never reached Together is inserted on the next run", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay(DAY, { checkin: true });
  c.set(TITLES_AT);
  fake.inject({ networkError: true, when: (r) => r.method === "POST" && r.url.includes("challenge_days") });
  expect(await send(fake, c)).toEqual({ kind: "offline" });
  expect(fake.days.size).toBe(0);
  expect(await send(fake, c)).toMatchObject({ kind: "ok", refused: 0 });
  expect(liveDays(fake)).toHaveLength(1);
});

it("an edited answer after it went: the note is overwritten; nothing changed: nothing sent (a replay sends nothing)", async () => {
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
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect(liveNote(fake, DAY)).toBe(`Mental Health Exercise\n${TITLE}\n\nPretend exercise answer`);
  expect(wire(fake)).not.toMatch(/Pretend later draft|Pretend half-done|Check In/);
});

it("a card's answers go as bold prompts with her answer below, checklist items included", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const jk = await keyFor("fake-journal-together");
  await confirmedDevice(db, jk);
  const set = parseCardFile(JSON.stringify(FAKE_CARD_FILE_CHECKLIST))!;
  await importExerciseCards(jk, set, DAY);
  const card = set.cards[0]!;
  const rows = PRETEND_FEATURES.map((f, i) => [f, i === 1 ? "Partly" : "Yes", i === 0 ? "Pretend note of mine" : ""]);
  await submitExerciseEntry(jk, DAY, DEVICE, cardRef(card), [{ prompt: card.parts[0]!.prompt, kind: "checklist", answer: rows }]);
  c.set(TITLES_AT);
  await send(fake, c);
  expect(liveNote(fake, DAY)).toContain(`**${card.parts[0]!.prompt}**`); // the question goes with the titles
  expect(liveNote(fake, DAY)).not.toContain("Pretend note of mine");
  c.set(ANSWERS_AT);
  await send(fake, c);
  const note = liveNote(fake, DAY)!;
  expect(note).toContain(`**${card.parts[0]!.prompt}**\n${PRETEND_FEATURES[0]}: Yes (Pretend note of mine)`);
  expect(note).toContain(`${PRETEND_FEATURES[1]}: Partly`);
});

it("an n/a answer is left out with its question; a part with nothing left is left out", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, q1, q2 } = await journalDay(DAY, { exercise: true });
  await ensureCheckinSet(jk, DAY, [q1.id, q2.id]);
  await saveAnswer(jk, DAY, q1.id, DEVICE, " N/A. ", true);
  await saveAnswer(jk, DAY, q2.id, DEVICE, "n.a", true);
  c.set(TITLES_AT);
  await send(fake, c);
  expect(liveNote(fake, DAY)).toBe(`Mental Health Exercise\n${TITLE}`);
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect(liveNote(fake, DAY)).toBe(`Mental Health Exercise\n${TITLE}\n\nPretend exercise answer`);
  expect(wire(fake)).not.toContain(q1.text.slice(0, 30));
});

it("what she learned and highlights go only with an exercise day", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay(DAY, { checkin: true, learned: "Pretend learned on a day without a card" });
  await highlightOn(DAY, "pretend Pellmoor hill", "Pretend Pellmoor note");
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect(liveNote(fake, DAY)).toMatch(/^Check In\n/);
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
  c.set(TITLES_AT);
  await send(fake, c);
  expect(wire(fake)).not.toMatch(/Wrenfold|Quillby/);
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect(liveNote(fake, DAY)).toBe(
    `Mental Health Exercise\n${TITLE}\n\nResearch notes\n• Pretend learned words\n• pretend Wrenfold clouds — Pretend Wrenfold note\n• pretend Quillby stream\n\nPretend exercise answer`,
  );
  expect(wire(fake)).not.toMatch(/Gristlecomb|Pellmoor/);
});

it("a day un-ticked after it went: our row marked deleted; ticked again: the same row shown again", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk, card } = await journalDay(DAY, { exercise: true });
  c.set(TITLES_AT);
  await send(fake, c);
  await saveExerciseMark(jk, DAY, DEVICE, card.id, false);
  await send(fake, c);
  expect(dayRow(fake, DAY)!.deleted_at).not.toBeNull();
  await saveExerciseMark(jk, DAY, DEVICE, card.id, true);
  await send(fake, c);
  expect(fake.days.size).toBe(1);
  expect(dayRow(fake, DAY)).toMatchObject({ deleted_at: null, note: `Mental Health Exercise\n${TITLE}` });
});

it("a day she logged by hand in Together is left exactly as she wrote it, and never tried again", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay(DAY);
  const hers = fake.logByHand({ couple_id: COUPLE, challenge_id: CHALLENGE, day: DAY, note: "Pretend note she typed in Together", by: ME });
  c.set(TITLES_AT);
  expect(await send(fake, c)).toMatchObject({ kind: "ok", refused: 0 });
  expect(fake.days.size).toBe(1);
  expect(fake.days.get(String(hers.id))!.note).toBe("Pretend note she typed in Together");
  expect((await readSent(db))!.byHand).toEqual({ [DAY]: true });
  const n = dayWrites(fake).length;
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect(dayWrites(fake).length).toBe(n);
  expect(fake.days.get(String(hers.id))!.note).toBe("Pretend note she typed in Together");
});

it("journal locked on this device: nothing sent, and nothing already sent is touched", async () => {
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
  expect(liveDays(fake)).toHaveLength(1);
});

it("a refused overwrite of a day with answers is set aside as \"couldn't be hidden\"; Send now tries again", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { checkin: true });
  c.set(ANSWERS_AT);
  await send(fake, c);
  await saveSharePrivate(jk, DAY, "checkin", true);
  fake.inject({ status: 403, body: { code: "42501" }, when: (r) => r.method === "PATCH" && r.url.includes("challenge_days") });
  expect(await send(fake, c)).toMatchObject({ kind: "ok", refused: 1 });
  expect(Object.values((await readSent(db))!.refused)).toEqual([expect.objectContaining({ what: "hide" })]);
  expect(await send(fake, c, true)).toMatchObject({ kind: "ok", refused: 0 }); // Send now tries again
  expect(liveNote(fake, DAY)).not.toContain("Pretend check-in answer");
});

it("bug #49: a day is written down before its insert goes, and recorded once it is confirmed", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay(DAY, { checkin: true });
  c.set(TITLES_AT);
  let seenBefore: unknown = null;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST" && String(input).includes("challenge_days")) seenBefore = { ...(await readSent(db))!.days };
    return fake.fetch(input, init);
  }) as typeof fetch;
  const { sendToTogether } = await import("./sender");
  expect(await sendToTogether({ fetch: f, now: c.now })).toMatchObject({ kind: "ok" });
  expect(seenBefore).toEqual({ [DAY]: { hash: "", live: true, parts: { exercise: "answers", checkin: "answers" } } });
  expect((await readSent(db))!.days![DAY]).toMatchObject({ live: true, parts: { checkin: "titles" } });
  expect((await readSent(db))!.days![DAY]!.hash).not.toBe("");
});

it("bug #59: a whole part that can't be read (the card file won't open here): a day ticked private is still hidden", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  const { jk } = await journalDay(DAY, { exercise: true });
  c.set(ANSWERS_AT);
  await send(fake, c);
  expect(liveNote(fake, DAY)).toContain("Pretend exercise answer");
  const other = await keyFor("fake-journal-some-other-key");
  const cards = (await db.journal.get("cards"))!;
  await db.journal.put({ ...cards, fp: other.fp, ...(await sealJson(other.key, { v: 1 }, journalAad("cards"))) });
  const n = dayWrites(fake).length;
  await send(fake, c);
  expect(dayWrites(fake).length).toBe(n); // not private: left as it is
  await saveSharePrivate(jk, DAY, "exercise", true);
  await send(fake, c);
  expect(liveDays(fake)).toHaveLength(1);
  expect(liveNote(fake, DAY)).toBe("Mental Health Exercise");
});
