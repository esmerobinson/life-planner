import { db } from "../data/db";
import { saveSharePrivate } from "../data/repo";
import { endPastHold } from "./sender";
import { readSent } from "./store";
import { clock, emptyDb, highlightOn, journalDay, liveNote, send, signedIn } from "./testKit";

// "Send past days' answers now" (Esme, 2026-11-09): ends only the past-days hold. Private ticks,
// the 24 h after a new day ends, and the 24 h after research notes change (review I2) still apply.
// Fake Together only, every word made up.

beforeEach(emptyDb);

const PAST = "2026-10-20";
const PAST_PRIVATE = "2026-10-25";
const PAST_LATE_NOTE = "2026-10-28";
const DAY = "2026-11-04"; // the sign-in day: a new day, not a past one

async function setUp() {
  const c = clock(`${DAY}T09:30:00`);
  await journalDay(PAST, { exercise: true, checkin: true });
  const { jk } = await journalDay(PAST_PRIVATE, { exercise: true, checkin: true });
  await saveSharePrivate(jk, PAST_PRIVATE, "exercise", true);
  await saveSharePrivate(jk, PAST_PRIVATE, "checkin", true);
  await journalDay(PAST_LATE_NOTE, { exercise: true });
  await highlightOn(PAST_LATE_NOTE, "pretend Gorsedale stile", "Pretend Gorsedale note written today"); // research changed today
  c.set(`${DAY}T10:00:00`);
  const fake = await signedIn(c);
  await journalDay("2026-11-03", { checkin: true }); // yesterday: ended at 3am today, its own 24 h not up
  c.set(`${DAY}T10:01:00`);
  await send(fake, c);
  return { c, fake };
}

it("while held: titles only, and the record says a past day is waiting on the hold", async () => {
  const { fake } = await setUp();
  for (const d of [PAST, PAST_PRIVATE, PAST_LATE_NOTE, "2026-11-03"]) expect(liveNote(fake, d)).toBeDefined();
  expect(JSON.stringify(fake.requests)).not.toMatch(/Pretend exercise answer|Pretend check-in answer|Gorsedale note/);
  expect((await readSent(db))!.pastWaiting).toBe(true);
});

it("pressed: only the past-days hold ends; private days stay titles-only, late research notes and new days keep their 24 h; a replay sends nothing", async () => {
  const { c, fake } = await setUp();
  c.set(`${DAY}T11:00:00`);
  expect(await endPastHold(c.now())).toBe(true);
  expect((await readSent(db))!.pastUntil).toBe(c.now());
  await send(fake, c);
  expect(liveNote(fake, PAST)).toContain("Pretend exercise answer");
  expect(liveNote(fake, PAST)).toContain("Pretend check-in answer");
  expect(liveNote(fake, PAST_PRIVATE)).not.toMatch(/Pretend exercise answer|Pretend check-in answer/);
  expect(liveNote(fake, PAST_LATE_NOTE)).not.toMatch(/Pretend exercise answer|Gorsedale note/); // I2: 24 h after the note
  expect(liveNote(fake, "2026-11-03")).not.toContain("Pretend check-in answer"); // its own 24 h: 3am on 5 Nov
  expect((await readSent(db))!.pastWaiting).toBe(false);
  const n = fake.requests.length;
  expect(await send(fake, c)).toMatchObject({ kind: "ok", sent: 0 });
  expect(fake.requests.length).toBe(n);
  // Those still go at their own times.
  c.set("2026-11-05T09:31:00");
  await send(fake, c);
  expect(liveNote(fake, PAST_LATE_NOTE)).toContain("— Pretend Gorsedale note written today");
  expect(liveNote(fake, "2026-11-03")).toContain("Pretend check-in answer");
  expect(liveNote(fake, PAST_PRIVATE)).not.toMatch(/Pretend exercise answer|Pretend check-in answer/);
});

it("nothing to end: once the hold is over (or with no record), it changes nothing", async () => {
  const { c } = await setUp();
  c.set("2026-11-05T10:00:01");
  const before = (await readSent(db))!.pastUntil;
  expect(await endPastHold(c.now())).toBe(false);
  expect((await readSent(db))!.pastUntil).toBe(before);
  await emptyDb();
  expect(await endPastHold(c.now())).toBe(false);
});
