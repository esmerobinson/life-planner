import { saveWeekReview } from "../data/repo";
import { EMPTY_WEEK_REVIEW } from "../journal/routine";
import { exerciseSection, exerciseSummary, readJournalDays, reviewQAs } from "./journalNotes";
import { DEVICE, emptyDb, journalDay } from "./testKit";

// The weekly review goes with that day's Mental health exercise note, under "Weekly review"
// (Esme, 16 Nov 2026): its questions in bold and her answers; titles only = the questions alone.
// Only a review she pressed Done on. Made-up words.

beforeEach(emptyDb);

const REVIEW = { well: "Pretend Pellucid went well", inWay: "n/a", values: 7, ifThen: "If pretend rain, then pretend tea", minDays: ["wed" as const, "mon" as const] };

it("a card and a review: the review's block after the cards; titles only, the questions alone", () => {
  const qas = reviewQAs(REVIEW);
  const cards = [{ title: "Pretend card", qas: [{ q: "", a: "Pretend answer" }] }];
  expect(exerciseSection(cards, [], true, qas)).toBe(
    "## Mental Health Exercise\n\n### Pretend card\nPretend answer\n\n### Weekly review\n" +
      "**What went well?**\nPretend Pellucid went well\n\n**Am I living my values? (1–10)**\n7 out of 10\n\n" +
      "**One if-then plan for next week**\nIf pretend rain, then pretend tea\n\n**Which minimum days do I expect?**\nMonday, Wednesday",
  );
  expect(exerciseSection([], [], false, qas)).toBe(
    "## Mental Health Exercise\n\n### Weekly review\n**What went well?**\n**Am I living my values? (1–10)**\n**One if-then plan for next week**\n**Which minimum days do I expect?**",
  );
  // Without a review, exactly as before.
  expect(exerciseSection(cards, [], true)).toBe("## Mental Health Exercise\n\n### Pretend card\nPretend answer");
  expect(exerciseSummary(2, true)).toBe("2 exercises · Weekly review");
  expect(exerciseSummary(0, true)).toBe("Weekly review");
});

it("read from the journal: a done review makes that day's exercise part; a draft review never goes", async () => {
  const { jk } = await journalDay("2026-11-14", { exercise: true });
  await saveWeekReview(jk, DEVICE, REVIEW, { date: "2026-11-15", seen: [], submittedAt: null }, true);
  await saveWeekReview(jk, DEVICE, { ...EMPTY_WEEK_REVIEW, well: "Pretend draft review" }, { date: "2026-11-17", seen: [], submittedAt: null });
  const days = await readJournalDays(jk, "2026-11-30");
  const sun = days.exercise!.notes.get("2026-11-15")!;
  expect(sun.summary).toBe("Weekly review");
  expect(sun.full).toContain("### Weekly review\n**What went well?**\nPretend Pellucid went well");
  expect(sun.titles).not.toContain("Pellucid");
  expect(days.exercise!.notes.has("2026-11-17")).toBe(false);
  expect(days.exercise!.notes.get("2026-11-14")!.full).not.toContain("Weekly review");
});

// ---- sending, with every request recorded --------------------------------------------------------

describe("Send now with a weekly review (every request recorded)", () => {
  const SUN = "2026-11-15";
  const WORDS = ["Pretend Pellucid went well", "If pretend rain, then pretend tea"];

  async function setUp(privateTick: boolean, done = true) {
    const { clock, guardedFetch, signedIn } = await import("./testKit");
    const { saveSharePrivate } = await import("../data/repo");
    const c = clock(`${SUN}T20:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(SUN, {});
    await saveWeekReview(jk, DEVICE, REVIEW, { date: SUN, seen: [], submittedAt: null }, done);
    if (privateTick) await saveSharePrivate(jk, SUN, "exercise", true);
    const rec = guardedFetch(fake.fetch, () => (privateTick || !done ? WORDS : []), c.now);
    return { c, fake, rec, jk };
  }

  it("goes with that day's exercise note at once, under Weekly review", async () => {
    const { sendToTogether } = await import("./sender");
    const { liveNote } = await import("./testKit");
    const { c, fake, rec } = await setUp(false);
    expect(await sendToTogether({ fetch: rec.fetch, now: c.now })).toMatchObject({ kind: "ok" });
    const note = liveNote(fake, SUN)!;
    expect(note.split("\n")[0]).toBe("Weekly review");
    expect(note).toContain("### Weekly review\n**What went well?**\nPretend Pellucid went well");
    expect(rec.violations).toEqual([]);
  });

  it("ticked private: only its questions go, never her words", async () => {
    const { sendToTogether } = await import("./sender");
    const { liveNote } = await import("./testKit");
    const { c, fake, rec } = await setUp(true);
    await sendToTogether({ fetch: rec.fetch, now: c.now });
    expect(liveNote(fake, SUN)).toContain("### Weekly review\n**What went well?**");
    expect(rec.violations).toEqual([]);
  });

  it("a review without Done never goes (nothing for that day at all)", async () => {
    const { sendToTogether } = await import("./sender");
    const { c, fake, rec } = await setUp(false, false);
    await sendToTogether({ fetch: rec.fetch, now: c.now });
    expect(fake.days.size).toBe(0);
    expect(rec.violations).toEqual([]);
  });

  it("ticked private after it went: the next automatic run takes her words out", async () => {
    const { sendToTogether } = await import("./sender");
    const { liveNote } = await import("./testKit");
    const { saveSharePrivate } = await import("../data/repo");
    const { c, fake, rec, jk } = await setUp(false);
    await sendToTogether({ fetch: rec.fetch, now: c.now });
    expect(liveNote(fake, SUN)).toContain("Pellucid");
    await saveSharePrivate(jk, SUN, "exercise", true);
    await sendToTogether({ fetch: rec.fetch, now: c.now, mode: "hide" });
    expect(liveNote(fake, SUN)).not.toContain("Pellucid");
    expect(liveNote(fake, SUN)).toContain("### Weekly review");
  });
});
