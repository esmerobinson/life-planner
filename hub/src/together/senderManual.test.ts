import { db } from "../data/db";
import { saveAnswer, saveExerciseMark, saveLearned, saveSharePrivate } from "../data/repo";
import { addDays } from "../domain/dates";
import { MAX_WRITES_PER_RUN, sendToTogether } from "./sender";
import { readSent } from "./store";
import { clock, dayWrites, DEVICE, emptyDb, highlightOn, journalDay, liveDays, liveNote, signedIn, type Clock } from "./testKit";
import type { FakeSupabase } from "./fakeSupabase";

// Sending is manual (Esme, 2026-11-09): only "Send now" sends, everything new or changed up to
// and including today, answers too, unless ticked private. The automatic runs (after a sync, on
// opening) only take words out. Fake Together only, every word made up.

beforeEach(emptyDb);

const DAY = "2026-11-04";
const press = (fake: FakeSupabase, c: Clock, extra: { batchPauseMs?: number } = {}) =>
  sendToTogether({ fetch: fake.fetch, now: c.now, retryRefused: true, mode: "send", batchPauseMs: 0, ...extra });
const auto = (fake: FakeSupabase, c: Clock) => sendToTogether({ fetch: fake.fetch, now: c.now, mode: "hide" });
const ANSWER = /Pretend exercise answer|Pretend check-in answer/;

it("nothing goes without a press: automatic runs, days later, write nothing (not even titles), and look nothing up", async () => {
  const c = clock(`${DAY}T10:00:00`);
  const fake = await signedIn(c);
  await journalDay("2026-11-01", { exercise: true, checkin: true });
  await journalDay(DAY, { exercise: true, checkin: true });
  for (const at of [`${DAY}T20:00:00`, "2026-11-05T03:30:00", "2026-11-07T09:00:00"]) {
    c.set(at);
    expect(await auto(fake, c)).toMatchObject({ kind: "ok" });
  }
  expect(fake.requests.filter((r) => r.url.includes("/rest/v1/") && !r.url.includes("members"))).toEqual([]);
  expect(fake.days.size).toBe(0);
});

it("a press sends every day up to and including today with answers and research notes at once; private days titles only", async () => {
  const c = clock(`${DAY}T09:00:00`);
  const fake = await signedIn(c);
  const { jk } = await journalDay("2026-10-20", { exercise: true, checkin: true });
  await journalDay("2026-10-25", { exercise: true, checkin: true });
  await saveSharePrivate(jk, "2026-10-25", "exercise", true);
  await saveSharePrivate(jk, "2026-10-25", "checkin", true);
  await journalDay(DAY, { exercise: true, checkin: true, learned: "Pretend Hollinsclough learned today" });
  await highlightOn(DAY, "pretend Hollinsclough ford", "Pretend Hollinsclough note");
  c.set(`${DAY}T10:00:00`); // the same day: no 3am, no 24 h
  expect(await press(fake, c)).toMatchObject({ kind: "ok", refused: 0 });
  expect(liveNote(fake, DAY)).toMatch(ANSWER);
  expect(liveNote(fake, DAY)).toContain("• Pretend Hollinsclough learned today");
  expect(liveNote(fake, DAY)).toContain("• pretend Hollinsclough ford — Pretend Hollinsclough note");
  expect(liveNote(fake, "2026-10-20")).toMatch(ANSWER);
  expect(liveNote(fake, "2026-10-25")).not.toMatch(ANSWER);
  expect(liveNote(fake, "2026-10-25")).toMatch(/^1 exercise · Check In\n/);
  expect((await readSent(db))!.progress).toEqual({ done: 3, total: 3 });
  expect((await readSent(db))!.lastCopiedAt).toBe(c.now());
});

it("pressing again after edits updates only the changed days; a replay sends nothing", async () => {
  const c = clock(`${DAY}T09:00:00`);
  const fake = await signedIn(c);
  await journalDay("2026-11-03", { checkin: true });
  const { jk, q1 } = await journalDay(DAY, { checkin: true });
  await press(fake, c);
  const n = fake.requests.length;
  expect(await press(fake, c)).toMatchObject({ kind: "ok", sent: 0 });
  expect(fake.requests.slice(n).filter((r) => r.method !== "GET")).toEqual([]);
  expect((await readSent(db))!.progress).toEqual({ done: 0, total: 0 });
  c.set(`${DAY}T15:00:00`);
  await saveAnswer(jk, DAY, q1.id, DEVICE, "Pretend Ravensworth edited today", true, { session: "1" });
  await saveLearned(jk, DAY, DEVICE, "Pretend Ravensworth learned"); // no card that day: never sent
  const m = dayWrites(fake).length;
  await auto(fake, c);
  expect(dayWrites(fake).length, "an edit waits for a press").toBe(m);
  await press(fake, c);
  expect(dayWrites(fake).slice(m).map((r) => r.method)).toEqual(["PATCH"]);
  expect(liveNote(fake, DAY)).toContain("Pretend Ravensworth edited today");
  expect(JSON.stringify(fake.requests)).not.toContain("Pretend Ravensworth learned");
});

it("taking words out is automatic: a private tick after sending, and a day emptied, apply on the next automatic run", async () => {
  const c = clock(`${DAY}T09:00:00`);
  const fake = await signedIn(c);
  const { jk } = await journalDay("2026-11-03", { exercise: true, checkin: true });
  const { card } = await journalDay(DAY, { exercise: true });
  await press(fake, c);
  expect(liveNote(fake, "2026-11-03")).toMatch(ANSWER);
  await saveSharePrivate(jk, "2026-11-03", "checkin", true);
  await saveExerciseMark(jk, DAY, DEVICE, card.id, false);
  await auto(fake, c);
  expect(liveNote(fake, "2026-11-03")).not.toMatch(ANSWER); // over-hides: the whole day titles only until the next press
  expect(liveNote(fake, DAY)).toBeUndefined(); // marked deleted
  expect(JSON.stringify([...fake.days.values()])).not.toContain("Pretend check-in answer");
  await press(fake, c);
  expect(liveNote(fake, "2026-11-03")).toContain("Pretend exercise answer");
  expect(liveNote(fake, "2026-11-03")).not.toContain("Pretend check-in answer");
});

it(`a press of more than ${MAX_WRITES_PER_RUN} days goes on in batches in the same press until done, saying how far it got`, async () => {
  const first = "2026-09-01";
  const dates = Array.from({ length: MAX_WRITES_PER_RUN * 2 + 10 }, (_, i) => addDays(first, i));
  for (const d of dates) await journalDay(d, { checkin: true });
  const c = clock("2027-01-01T10:00:00");
  const fake = await signedIn(c);
  const seen: { done: number; total: number }[] = [];
  const watched = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST" && String(input).includes("challenge_days")) seen.push({ ...(await readSent(db))!.progress! });
    return fake.fetch(input, init);
  }) as typeof fetch;
  expect(await sendToTogether({ fetch: watched, now: c.now, mode: "send", batchPauseMs: 1 })).toMatchObject({ kind: "ok", refused: 0 });
  const got = new Set(liveDays(fake).map((d) => String(d.day)));
  expect(dates.filter((d) => !got.has(d))).toEqual([]);
  expect(liveDays(fake).every((d) => String(d.note).includes("Pretend check-in answer"))).toBe(true);
  expect(seen[0]).toEqual({ done: 0, total: dates.length });
  expect(seen.some((p) => p.done === MAX_WRITES_PER_RUN + 5)).toBe(true);
  expect((await readSent(db))!.progress).toEqual({ done: dates.length, total: dates.length });
  expect((await readSent(db))!.backlog).toBe(false);
}, 60_000);

it("a press that stops part way (offline) says how far it got; the next press finishes the rest", async () => {
  const dates = ["2026-11-01", "2026-11-02", "2026-11-03"];
  for (const d of dates) await journalDay(d, { checkin: true });
  const c = clock(`${DAY}T10:00:00`);
  const fake = await signedIn(c);
  let posts = 0;
  fake.inject({ networkError: true, when: (r) => r.method === "POST" && r.url.includes("challenge_days") && ++posts === 2 });
  expect(await press(fake, c)).toEqual({ kind: "offline" });
  expect((await readSent(db))!.progress).toEqual({ done: 1, total: 3 });
  expect(await press(fake, c)).toMatchObject({ kind: "ok" });
  expect(liveDays(fake)).toHaveLength(3);
});

describe("highlights (Esme asked why no row has research notes)", () => {
  it("made today on an older card's words (as in the chapter map): in today's row, under today's research notes", async () => {
    const { createHighlight } = await import("../data/repo");
    const { describeAnchor } = await import("../journal/highlights");
    const c = clock(`${DAY}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(DAY, { exercise: true }); // today's card: b-001
    const olderCard = { id: "b-004", track: "bpd", book: "Pretend first workbook", day: 4, chapter: 2, chapterTitle: "Pretend river", theme: "Pretend first-book four" };
    const text = "A made-up learning text that says pretend Kettlewell beck in the middle of it.";
    const start = text.indexOf("pretend Kettlewell beck");
    await createHighlight(jk, DAY, DEVICE, olderCard, describeAnchor("learn", text, start, start + "pretend Kettlewell beck".length)!, "Pretend Kettlewell note");
    await press(fake, c);
    expect(liveNote(fake, DAY)).toContain("## Research notes\n• pretend Kettlewell beck — Pretend Kettlewell note");
  });

  it("on a day with no card done, highlights and learned words never go (no row for an exercise that day)", async () => {
    const c = clock(`${DAY}T09:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(DAY, { checkin: true });
    await saveLearned(jk, DAY, DEVICE, "Pretend Swaledale learned");
    await highlightOn(DAY, "pretend Swaledale scar", "Pretend Swaledale note");
    await press(fake, c);
    expect(liveNote(fake, DAY)).toMatch(/^Check In\n/);
    expect(JSON.stringify(fake.requests)).not.toMatch(/Swaledale/);
  });
});
