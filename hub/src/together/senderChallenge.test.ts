import { db } from "../data/db";
import { saveSharePrivate } from "../data/repo";
import { addDays } from "../domain/dates";
import { togetherId } from "./ids";
import { ANSWERS_DELAY_MS, MAX_WRITES_PER_RUN, stopTogether } from "./sender";
import { readSent, saveSent, type TogetherSent } from "./store";
import {
  CHALLENGE, clock, COUPLE, dayRow, dayWrites, emptyDb, journalDay, liveDays, liveNote, ME, send, signedIn,
} from "./testKit";

// The backfill (2026-11-08), the pace of a big one, an earlier build's habits cleaned up, and Stop
// with removing, against the fake Together. Made-up days and words.

const DAY = "2026-11-04";
const SIGN_IN = `${DAY}T10:00:00`;
const PAST_1 = "2026-10-20";
const PAST_2 = "2026-10-25";

beforeEach(emptyDb);

describe("the backfill: every day from her first, past days' answers 24 h after sign-in", () => {
  it("past days go at once with titles; their answers wait 24 h after sign-in; a replay sends nothing", async () => {
    await journalDay(PAST_1, { exercise: true });
    await journalDay(PAST_2, { checkin: true });
    const c = clock(SIGN_IN);
    const fake = await signedIn(c);
    await journalDay(DAY, { checkin: true });
    expect((await readSent(db))!).toMatchObject({ pastBefore: DAY, pastUntil: new Date(SIGN_IN).getTime() + ANSWERS_DELAY_MS });
    await send(fake, c); // the same day as sign-in: past days' titles
    expect(liveDays(fake).map((d) => d.day)).toEqual([PAST_1, PAST_2]);
    expect(JSON.stringify(fake.requests)).not.toMatch(/Pretend exercise answer|Pretend check-in answer/);
    expect((await readSent(db))!.since).toBe(PAST_1);
    c.set("2026-11-05T09:59:00"); // just under 24 h after sign-in
    await send(fake, c);
    expect(JSON.stringify(fake.requests)).not.toMatch(/Pretend exercise answer|Pretend check-in answer/);
    expect(liveDays(fake).map((d) => d.day)).toEqual([PAST_1, PAST_2, DAY]);
    c.set("2026-11-05T10:00:00");
    await send(fake, c);
    expect(liveNote(fake, PAST_1)).toContain("Pretend exercise answer");
    expect(liveNote(fake, PAST_2)).toContain("Pretend check-in answer");
    expect(liveNote(fake, DAY)).not.toContain("Pretend check-in answer"); // its own 24 h: 3am Nov 6
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    expect(liveNote(fake, DAY)).toContain("Pretend check-in answer");
    const n = fake.requests.length;
    expect(await send(fake, c)).toMatchObject({ kind: "ok", sent: 0 });
    expect(fake.requests.length).toBe(n);
  });

  it("a past day ticked private before the 24 h are up: its answers never go", async () => {
    const { jk } = await journalDay(PAST_1, { exercise: true, checkin: true });
    const c = clock(SIGN_IN);
    const fake = await signedIn(c);
    await send(fake, c);
    await saveSharePrivate(jk, PAST_1, "exercise", true);
    await saveSharePrivate(jk, PAST_1, "checkin", true);
    c.set("2026-11-08T10:00:00");
    await send(fake, c);
    expect(liveNote(fake, PAST_1)).toMatch(/\n## Mental Health Exercise\n/);
    expect(JSON.stringify(fake.requests)).not.toMatch(/Pretend exercise answer|Pretend check-in answer/);
  });

  it("a device already signed in (an earlier build's record) widens to her first day, past days held 24 h from the update", async () => {
    await journalDay(PAST_1, { checkin: true });
    const c = clock(SIGN_IN);
    const fake = await signedIn(c);
    await journalDay(DAY, { checkin: true });
    // As an earlier build left it: since the sign-in day, no day record, no past-day hold.
    const old = (await readSent(db))!;
    const { days: _d, pastBefore: _p, pastUntil: _u, ...rest } = old;
    await saveSent(db, { ...rest, since: DAY } as TogetherSent);
    c.set("2026-11-08T12:00:00"); // the update's first run
    await send(fake, c);
    expect((await readSent(db))!).toMatchObject({ since: PAST_1, pastBefore: "2026-11-08", pastUntil: new Date("2026-11-08T12:00:00").getTime() + ANSWERS_DELAY_MS });
    expect(liveDays(fake).map((d) => d.day)).toEqual([PAST_1, DAY]);
    expect(JSON.stringify(fake.requests)).not.toContain("Pretend check-in answer"); // DAY is a past day too now
    c.set("2026-11-09T12:00:00");
    await send(fake, c);
    expect(liveNote(fake, PAST_1)).toContain("Pretend check-in answer");
    expect(liveNote(fake, DAY)).toContain("Pretend check-in answer");
  });

  it(`at most ${MAX_WRITES_PER_RUN} rows a run; the rest next run`, async () => {
    const first = "2026-09-01";
    const dates = Array.from({ length: MAX_WRITES_PER_RUN + 5 }, (_, i) => addDays(first, i));
    for (const d of dates) await journalDay(d, { checkin: true });
    const c = clock(SIGN_IN);
    const fake = await signedIn(c);
    await send(fake, c);
    expect(dayWrites(fake)).toHaveLength(MAX_WRITES_PER_RUN);
    expect((await readSent(db))!.backlog).toBe(true);
    await send(fake, c);
    expect(liveDays(fake)).toHaveLength(dates.length);
    expect((await readSent(db))!.backlog).toBe(false);
    // 24 h on, every day gets its answers over two runs; then a private tick on one hides it.
    c.set("2026-11-05T10:00:00");
    await send(fake, c);
    await send(fake, c);
    expect(liveDays(fake).every((d) => String(d.note).includes("Pretend check-in answer"))).toBe(true);
    const { jk } = await journalDay(dates.at(-1)!, { checkin: false });
    await saveSharePrivate(jk, dates.at(-1)!, "checkin", true);
    await send(fake, c);
    expect(liveNote(fake, dates.at(-1)!)).not.toContain("Pretend check-in answer");
  }, 60_000);
});

describe("an earlier build's habits (two to-dos and their tallies) are marked deleted once, then forgotten", () => {
  async function legacy(fake: Awaited<ReturnType<typeof signedIn>>, opts: { habitsDeleted: boolean; tallyDeleted: boolean }) {
    const ids = {
      exercise: await togetherId("habit", "exercise", 1),
      checkin: await togetherId("habit", "checkin", 1),
      tally: await togetherId("tally", "checkin:2026-11-07", 1),
    };
    const stamp = opts.habitsDeleted ? "2026-11-09T08:00:00.000Z" : null;
    fake.seedLegacy({ id: ids.exercise, couple_id: COUPLE, owner_id: ME, created_by: ME, title: "Mental health exercise", deleted_at: stamp });
    fake.seedLegacy({ id: ids.checkin, couple_id: COUPLE, owner_id: ME, created_by: ME, title: "Daily check-in", deleted_at: stamp }, [
      { id: ids.tally, couple_id: COUPLE, user_id: ME, at: "2026-11-07T12:00:00.000Z", note: "Pretend old tally", deleted_at: opts.tallyDeleted ? stamp ?? "2026-11-09T08:00:00.000Z" : null },
    ]);
    const old = (await readSent(db))!;
    await saveSent(db, {
      ...old,
      habits: { exercise: { tally: 0, deleted: false }, checkin: { tally: 1, deleted: false } },
      tallies: { "checkin:2026-11-07": { v: 1, hash: "x", live: true, answers: false } },
    });
    return ids;
  }

  for (const [label, opts] of [
    ["habits already deleted in Together, the tally not (as found on 2026-11-09)", { habitsDeleted: true, tallyDeleted: false }],
    ["everything already deleted (an event stays undone: counted as done)", { habitsDeleted: true, tallyDeleted: true }],
    ["nothing deleted yet", { habitsDeleted: false, tallyDeleted: false }],
  ] as const) {
    it(label, async () => {
      const c = clock(SIGN_IN);
      const fake = await signedIn(c);
      const ids = await legacy(fake, opts);
      await journalDay("2026-11-03", { checkin: true });
      expect(await send(fake, c)).toMatchObject({ kind: "ok", refused: 0 });
      expect(fake.todos.get(ids.exercise)!.deleted_at).not.toBeNull();
      expect(fake.todos.get(ids.checkin)!.deleted_at).not.toBeNull();
      expect(fake.events.get(ids.tally)!.deleted_at).not.toBeNull();
      const sent = (await readSent(db))!;
      expect(sent.habits).toBeUndefined();
      expect(sent.tallies).toBeUndefined();
      expect(liveDays(fake)).toHaveLength(1); // the challenge is logged as usual
      // Forgotten: never touched again.
      const n = fake.requests.filter((r) => /todos|todo_events/.test(r.url)).length;
      await send(fake, c);
      expect(fake.requests.filter((r) => /todos|todo_events/.test(r.url)).length).toBe(n);
      expect(fake.requests.filter((r) => /todos|todo_events/.test(r.url)).every((r) => r.method === "PATCH" && Object.keys(JSON.parse(r.body)).join() === "deleted_at")).toBe(true);
    });
  }

  it("a clean-up Together refuses is kept (shown as not yet hidden) and tried again on Send now; days still go", async () => {
    const c = clock(SIGN_IN);
    const fake = await signedIn(c);
    const ids = await legacy(fake, { habitsDeleted: false, tallyDeleted: false });
    await journalDay("2026-11-03", { checkin: true });
    fake.inject({ status: 403, body: { code: "42501" }, when: (r) => r.method === "PATCH" && r.url.includes("todo_events") });
    expect(await send(fake, c)).toMatchObject({ kind: "ok", refused: 1 });
    expect((await readSent(db))!.refused.habits).toMatchObject({ what: "hide" });
    expect(liveDays(fake)).toHaveLength(1);
    expect(await send(fake, c, true)).toMatchObject({ kind: "ok", refused: 0 });
    expect(fake.events.get(ids.tally)!.deleted_at).not.toBeNull();
    expect((await readSent(db))!.tallies).toBeUndefined();
  });
});

it("Stop with removing: our days marked deleted (never the challenge, never a day she logged by hand), its days kept as deleted", async () => {
  const c = clock(SIGN_IN);
  const fake = await signedIn(c);
  await journalDay("2026-11-02", { checkin: true });
  await journalDay("2026-11-03", { checkin: true });
  const hers = fake.logByHand({ couple_id: COUPLE, challenge_id: CHALLENGE, day: "2026-11-03", note: "Pretend hand-typed note", by: ME });
  await send(fake, c);
  expect(liveDays(fake)).toHaveLength(2);
  expect(await stopTogether({ fetch: fake.fetch, now: c.now }, { markDeleted: true })).toEqual({ kind: "ok" });
  expect(dayRow(fake, "2026-11-02")!.deleted_at).not.toBeNull();
  expect(fake.days.get(String(hers.id))!.deleted_at).toBeNull();
  expect(fake.challenges.get(CHALLENGE)!.deleted_at).toBeNull();
  expect(Object.values((await readSent(db))!.days ?? {}).filter((d) => d.live)).toEqual([]); // kept, every day marked deleted (review I3)
});
