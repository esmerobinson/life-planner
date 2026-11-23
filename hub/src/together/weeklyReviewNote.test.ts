import { saveWeekReview } from "../data/repo";
import { EMPTY_WEEK_REVIEW } from "../journal/routine";
import { readJournalDays } from "./journalNotes";
import { DEVICE, emptyDb, journalDay } from "./testKit";

// The (first) weekly review in that day's Mental health exercise note. Since v2 (Esme, 23 Nov
// 2026) only "Weekly review done" goes, never its questions or answers (weeklyReviewDoneOnly.test.ts
// has the full set); these keep review C1: the day she pressed Done, and only with Done.
// Made-up words.

beforeEach(emptyDb);

const REVIEW = { well: "Pretend Pellucid went well", inWay: "n/a", values: 7, ifThen: "If pretend rain, then pretend tea", minDays: ["wed" as const, "mon" as const] };

it("read from the journal: a done review makes that day's exercise part (only its line); a draft review never goes", async () => {
  const { clock } = await import("./testKit");
  const c = clock("2026-11-14T20:00:00");
  const { jk } = await journalDay("2026-11-14", { exercise: true });
  c.set("2026-11-15T20:00:00"); // Done pressed on Sunday
  await saveWeekReview(jk, DEVICE, REVIEW, { date: "2026-11-15", seen: [], submittedAt: null }, true);
  c.set("2026-11-17T20:00:00");
  await saveWeekReview(jk, DEVICE, { ...EMPTY_WEEK_REVIEW, well: "Pretend draft review" }, { date: "2026-11-17", seen: [], submittedAt: null });
  const days = await readJournalDays(jk, "2026-11-30");
  const sun = days.exercise!.notes.get("2026-11-15")!;
  expect(sun.summary).toBe("Weekly review done");
  expect(sun.full).toBe("## Mental Health Exercise\n\nWeekly review done");
  expect(sun.titles).toBe(sun.full);
  expect(days.exercise!.notes.has("2026-11-17")).toBe(false);
  expect(days.exercise!.notes.get("2026-11-14")!.full).not.toContain("Weekly review");
});

describe("review C1: the review goes under the day she pressed Done, and that day's private tick", () => {
  const MON = "2026-11-09";
  const SUN = "2026-11-15";
  const SUNDAY_WORDS = "Pretend Quillon Sunday words";

  /** Monday: a tap on "4" (saved, filed under Monday). Sunday: her words and Done (a new session, filed under Sunday). */
  async function touchedMondayDoneSunday() {
    const { clock } = await import("./testKit");
    const { readWeekReview } = await import("../data/repo");
    const c = clock(`${MON}T09:00:00`);
    const { signedIn } = await import("./testKit");
    const fake = await signedIn(c);
    const { jk } = await journalDay(MON, {});
    const mon = { date: MON, seen: [] as string[], submittedAt: null };
    await saveWeekReview(jk, DEVICE, { ...EMPTY_WEEK_REVIEW, values: 4 }, mon);
    c.set(`${SUN}T19:00:00`);
    const shown = await readWeekReview(jk, SUN);
    await saveWeekReview(jk, DEVICE, { ...shown.fields, well: SUNDAY_WORDS }, { date: SUN, seen: shown.seen, submittedAt: null }, true);
    return { c, fake, jk };
  }

  it("the reviewer's case: Done on Sunday, Sunday ticked private: her words never go; Monday has no note", async () => {
    const { guardedFetch, liveNote } = await import("./testKit");
    const { saveSharePrivate } = await import("../data/repo");
    const { sendToTogether } = await import("./sender");
    const { c, fake, jk } = await touchedMondayDoneSunday();
    await saveSharePrivate(jk, SUN, "exercise", true);
    const rec = guardedFetch(fake.fetch, () => [SUNDAY_WORDS, "Quillon", "4 out of 10"], c.now);
    await sendToTogether({ fetch: rec.fetch, now: c.now, retryRefused: true });
    expect(rec.violations).toEqual([]);
    expect(liveNote(fake, MON)).toBeUndefined();
    expect(liveNote(fake, SUN)).toBe("Weekly review done\n\n## Mental Health Exercise\n\nWeekly review done");
  });

  it("not private: it goes under Sunday (never Monday), and Sunday ticks the green row", async () => {
    const { liveNote } = await import("./testKit");
    const { sendToTogether } = await import("./sender");
    const { reviewDoneDays } = await import("../data/repo");
    const { c, fake, jk } = await touchedMondayDoneSunday();
    await sendToTogether({ fetch: fake.fetch, now: c.now });
    expect(liveNote(fake, MON)).toBeUndefined();
    expect(liveNote(fake, SUN)).toBe("Weekly review done\n\n## Mental Health Exercise\n\nWeekly review done");
    expect(JSON.stringify(fake.requests)).not.toContain("Quillon");
    expect([...(await reviewDoneDays(jk))]).toEqual([SUN]);
  });

  it("any day of that week holding a version of it ticked private (here Monday): still only the line", async () => {
    const { guardedFetch, liveNote } = await import("./testKit");
    const { saveSharePrivate } = await import("../data/repo");
    const { sendToTogether } = await import("./sender");
    const { c, fake, jk } = await touchedMondayDoneSunday();
    await saveSharePrivate(jk, MON, "exercise", true);
    const rec = guardedFetch(fake.fetch, () => [SUNDAY_WORDS, "Quillon", "4 out of 10"], c.now);
    await sendToTogether({ fetch: rec.fetch, now: c.now });
    expect(rec.violations).toEqual([]);
    expect(liveNote(fake, SUN)).toBe("Weekly review done\n\n## Mental Health Exercise\n\nWeekly review done");
  });
});
