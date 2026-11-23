import { saveLearned, saveSharePrivate, saveWeekReview, saveWeeklyReview, type FormSession } from "../data/repo";
import { EMPTY_WEEK_REVIEW } from "../journal/routine";
import { EMPTY_WEEKLY_REVIEW, type WeeklyReviewFields } from "../journal/weeklyReview";
import { ROUTINE_WORDS, WEEKLY_WORDS } from "../ui/journal/routineWording";
import { exerciseSection, exerciseSummary, readJournalDays, REVIEW_DONE } from "./journalNotes";
import { sendToTogether } from "./sender";
import { clock, DEVICE, dayWrites, emptyDb, guardedFetch, highlightOn, journalDay, liveNote, signedIn } from "./testKit";

// Weekly review v2 (Esme, 23 Nov 2026): "Oliver must see ONLY that it was done." The day's
// Together note says "Weekly review done" and nothing else of the review: no answers, no
// questions, no counts, no yes or no. This holds for the new review AND the earlier one, on every
// path: the exercise note (with and without cards), the private tick, Send now, the automatic
// runs, the hold after a Replace, "What I learned" and highlights. Made-up words only.

beforeEach(emptyDb);

const LAST = "2026-11-16"; // Monday of the week reviewed
const MON = "2026-11-23"; // the Monday she does it

/** Every answer, each a made-up word that must never reach Together; every choice "yes". */
const ANSWERS: WeeklyReviewFields = {
  selfHarm: "yes", selfHarmWhat: "Pretend Sablewick happened",
  urges: "yes", urgesNote: "Pretend Sablewick urges note",
  fight: "yes", fightAbout: "Pretend Sablewick dishes", fightTrigger: "Pretend Sablewick trigger", fightResolved: "Pretend Sablewick resolved",
  productive: "partly", achieved: "Pretend Sablewick achieved", struggled: "Pretend Sablewick struggled",
  well: "Pretend Sablewick well", inWay: "Pretend Sablewick in the way", values: 7, ifThen: "If pretend Sablewick, then pretend",
  minDays: ["wed"], dbt: "Pretend Sablewick skills", sleep: "poor", sleepNote: "Pretend Sablewick sleep", proud: "Pretend Sablewick proud",
  more: "Pretend Sablewick more reflections",
};
const NO_ANSWERS: WeeklyReviewFields = { ...ANSWERS, selfHarm: "no", urges: "no", fight: "no", productive: "no", sleep: "good" };

/** Every review word, every question (both kinds), every choice's words, and how values read. */
const FORBIDDEN = [
  "Sablewick", "7 out of 10", "Wednesday",
  ...(Object.values(WEEKLY_WORDS) as unknown[]).filter((w): w is string => typeof w === "string" && w !== WEEKLY_WORDS.tab && w !== WEEKLY_WORDS.done),
  ROUTINE_WORDS.well, ROUTINE_WORDS.inWay, ROUTINE_WORDS.values, ROUTINE_WORDS.ifThen, ROUTINE_WORDS.minDays,
  "self harm", "self-harm", "Oliver", "selfHarm", "fight", "sleep",
];
/** Any yes/no or other choice word, as a word on its own (the review's choices, in any case). */
const CHOICE_WORDS = /\b(yes|no|partly|good|ok|poor)\b/i;

const session = (date: string): FormSession => ({ date, seen: [], submittedAt: null });

describe("the note's words", () => {
  it("a day with cards: the cards as before, then only 'Weekly review done' (with or without answers)", () => {
    const cards = [{ title: "Pretend card", qas: [{ q: "", a: "Pretend answer" }] }];
    expect(exerciseSection(cards, [], true, true)).toBe("## Mental Health Exercise\n\n### Pretend card\nPretend answer\n\nWeekly review done");
    expect(exerciseSection(cards, [], false, true)).toBe("## Mental Health Exercise\n\n### Pretend card\n\nWeekly review done");
    expect(exerciseSection(cards, [], true)).toBe("## Mental Health Exercise\n\n### Pretend card\nPretend answer");
    expect(REVIEW_DONE).toBe("Weekly review done");
  });
  it("a day with only the review: the same note with or without answers", () => {
    expect(exerciseSection([], ["Pretend learned"], true, true)).toBe("## Mental Health Exercise\n\nWeekly review done");
    expect(exerciseSection([], [], false, true)).toBe("## Mental Health Exercise\n\nWeekly review done");
    expect(exerciseSummary(0, true)).toBe("Weekly review done");
    expect(exerciseSummary(2, true)).toBe("2 exercises · Weekly review done");
  });
});

describe("read from the journal", () => {
  it("the new review: full and titles-only are the same line; nothing of it in either", async () => {
    const c = clock(`${MON}T10:00:00`);
    const { jk } = await journalDay(MON, { exercise: true, learned: "Pretend Sablewick learned" });
    await saveWeeklyReview(jk, DEVICE, ANSWERS, session(LAST), true);
    c.set(`${MON}T23:00:00`);
    const days = await readJournalDays(jk, "2026-11-30");
    const note = days.exercise!.notes.get(MON)!;
    expect(note.summary).toBe("1 exercise · Weekly review done");
    expect(note.full.endsWith("\n\nWeekly review done")).toBe(true);
    expect(note.titles.endsWith("\n\nWeekly review done")).toBe(true);
    // Nothing of the review: only the card and that day's learned words are hers.
    expect(note.full.replace("Pretend Sablewick learned", "")).not.toContain("Sablewick");
    expect(days.exercise!.notes.has(LAST)).toBe(false);
  });

  it("the earlier review too: only the line, never its questions or answers", async () => {
    clock("2026-11-22T19:00:00");
    const { jk } = await journalDay("2026-11-22", {});
    await saveWeekReview(jk, DEVICE, { ...EMPTY_WEEK_REVIEW, well: "Pretend Sablewick old", values: 7, minDays: ["wed"] }, session("2026-11-22"), true);
    const note = (await readJournalDays(jk, "2026-11-30")).exercise!.notes.get("2026-11-22")!;
    expect(note).toMatchObject({ summary: "Weekly review done", full: "## Mental Health Exercise\n\nWeekly review done", titles: "## Mental Health Exercise\n\nWeekly review done" });
  });

  it("a week done both ways is one line, on the new review's day; a draft never goes", async () => {
    const c = clock("2026-11-22T19:00:00");
    const { jk } = await journalDay("2026-11-22", {});
    await saveWeekReview(jk, DEVICE, { ...EMPTY_WEEK_REVIEW, well: "Pretend Sablewick old" }, session("2026-11-22"), true);
    c.set(`${MON}T10:00:00`);
    await saveWeeklyReview(jk, DEVICE, ANSWERS, session(LAST), true);
    await saveWeeklyReview(jk, DEVICE, ANSWERS, session(MON)); // this week's: a draft
    const days = await readJournalDays(jk, "2026-11-30");
    expect([...days.exercise!.notes.keys()]).toEqual([MON]);
    expect(days.exercise!.notes.get(MON)!.full).toBe("## Mental Health Exercise\n\nWeekly review done");
  });
});

describe("sent, with every request recorded", () => {
  async function setUp(opts: { fields?: WeeklyReviewFields; cards?: boolean; privateTick?: boolean; highlight?: boolean } = {}) {
    const c = clock(`${MON}T10:00:00`);
    const fake = await signedIn(c);
    const { jk } = await journalDay(MON, { exercise: opts.cards ?? false, learned: "Pretend Sablewick learned" });
    if (opts.highlight) await highlightOn(MON, "made-up Sablewick phrase", "Pretend Sablewick note");
    await saveWeeklyReview(jk, DEVICE, opts.fields ?? ANSWERS, session(LAST), true);
    if (opts.privateTick) await saveSharePrivate(jk, MON, "exercise", true);
    const rec = guardedFetch(fake.fetch, () => FORBIDDEN, c.now);
    return { c, fake, rec, jk };
  }
  const noChoiceWords = (fake: Awaited<ReturnType<typeof signedIn>>) => {
    for (const r of dayWrites(fake)) expect(String(r.body ?? "")).not.toMatch(CHOICE_WORDS);
  };

  it("Send now, a review-only day: the note is exactly 'Weekly review done' (no learned words, no answers)", async () => {
    const { c, fake, rec } = await setUp();
    expect(await sendToTogether({ fetch: rec.fetch, now: c.now })).toMatchObject({ kind: "ok" });
    expect(liveNote(fake, MON)).toBe("Weekly review done\n\n## Mental Health Exercise\n\nWeekly review done");
    expect(liveNote(fake, LAST)).toBeUndefined();
    expect(rec.violations).toEqual([]);
    expect(JSON.stringify(fake.requests)).not.toContain("Sablewick");
    noChoiceWords(fake);
  });

  it("every answer No / Good: the same note, so not even a yes or no can be told apart", async () => {
    const a = await setUp();
    await sendToTogether({ fetch: a.rec.fetch, now: a.c.now });
    const yesNote = liveNote(a.fake, MON);
    await emptyDb();
    const b = await setUp({ fields: NO_ANSWERS });
    await sendToTogether({ fetch: b.rec.fetch, now: b.c.now });
    expect(liveNote(b.fake, MON)).toBe(yesNote);
    expect(b.rec.violations).toEqual([]);
    noChoiceWords(b.fake);
  });

  it("with a card, learned words and a highlight: they go as before; the review adds only its line", async () => {
    const { c, fake, rec } = await setUp({ cards: true, highlight: true });
    // The learned words and highlight are hers to send (that day's research notes), not the review's.
    const rec2 = guardedFetch(rec.fetch, () => FORBIDDEN.filter((w) => w !== "Sablewick"), c.now);
    await sendToTogether({ fetch: rec2.fetch, now: c.now });
    const note = liveNote(fake, MON)!;
    expect(note.split("\n")[0]).toBe("1 exercise · Weekly review done");
    expect(note).toContain("Pretend Sablewick learned"); // What I learned: as before
    expect(note.endsWith("\n\nWeekly review done")).toBe(true);
    for (const w of ["Pretend Sablewick happened", "dishes", "trigger", "resolved", "achieved", "struggled", "skills", "proud", "more reflections", "urges"]) {
      expect(note).not.toContain(w);
    }
    expect(rec2.violations).toEqual([]);
  });

  it("ticked private: the same line (there are no words of it to hold back)", async () => {
    const { c, fake, rec } = await setUp({ privateTick: true });
    await sendToTogether({ fetch: rec.fetch, now: c.now });
    expect(liveNote(fake, MON)).toBe("Weekly review done\n\n## Mental Health Exercise\n\nWeekly review done");
    expect(rec.violations).toEqual([]);
    noChoiceWords(fake);
  });

  it("the automatic runs never add it, and nothing of it goes later either (edit after Done, then the next run)", async () => {
    const { c, fake, rec, jk } = await setUp();
    await sendToTogether({ fetch: rec.fetch, now: c.now, mode: "hide" });
    expect(liveNote(fake, MON)).toBeUndefined(); // an automatic run sends nothing new
    await sendToTogether({ fetch: rec.fetch, now: c.now });
    const { readWeeklyReview } = await import("../data/repo");
    const shown = await readWeeklyReview(jk, LAST);
    await saveWeeklyReview(jk, DEVICE, { ...shown.fields, more: "Pretend Sablewick edited later" }, { date: LAST, seen: shown.seen, submittedAt: shown.submittedAt, doneOn: shown.doneOn });
    c.advance(25 * 60 * 60 * 1000);
    await sendToTogether({ fetch: rec.fetch, now: c.now, mode: "hide" });
    await sendToTogether({ fetch: rec.fetch, now: c.now });
    expect(liveNote(fake, MON)).toBe("Weekly review done\n\n## Mental Health Exercise\n\nWeekly review done");
    expect(rec.violations).toEqual([]);
    noChoiceWords(fake);
  });

  it("held after a Replace: still nothing of it", async () => {
    const { c, fake, rec } = await setUp();
    const { db } = await import("../data/db");
    const { readSent, saveSent } = await import("./store");
    const sent = (await readSent(db))!;
    sent.restoredAt = c.now();
    await saveSent(db, sent);
    await sendToTogether({ fetch: rec.fetch, now: c.now });
    const note = liveNote(fake, MON);
    if (note !== undefined) expect(note).toBe("Weekly review done\n\n## Mental Health Exercise\n\nWeekly review done");
    expect(rec.violations).toEqual([]);
    noChoiceWords(fake);
  });
});

describe("a day already sent with the earlier review's words", () => {
  it("the next automatic run takes them out, leaving everything else of the day as it was", async () => {
    // What an earlier build sent: the old review's questions and answers. Built here by hand from
    // the earlier format, then the record says it went (as an earlier build's run would leave it).
    const c = clock("2026-11-22T19:00:00");
    const fake = await signedIn(c);
    const { jk } = await journalDay("2026-11-22", { exercise: true });
    await saveLearned(jk, "2026-11-22", DEVICE, "Pretend learned words");
    await saveWeekReview(jk, DEVICE, { ...EMPTY_WEEK_REVIEW, well: "Pretend Sablewick old answer", values: 7 }, session("2026-11-22"), true);
    const { dayNote } = await import("./journalNotes");
    const days = await readJournalDays(jk, "2026-11-23");
    const old = days.exercise!.notes.get("2026-11-22")!.earlier!.find((e) => e.answers && e.text.includes("Sablewick"))!;
    const oldNote = dayNote([{ summary: old.summary, text: old.text }]);
    expect(oldNote.split("\n")[0]).toBe("1 exercise · Weekly review");
    expect(oldNote).toContain("Pretend Sablewick old answer");
    // Sent, then made into what the earlier build left: its note in Together, and its record here.
    await sendToTogether({ fetch: fake.fetch, now: c.now });
    const { db } = await import("../data/db");
    const { readSent, saveSent } = await import("./store");
    const sent = (await readSent(db))!;
    fake.dayRow("bpd-research", "2026-11-22")!.note = oldNote;
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${sent.salt}|${oldNote}`)));
    const hash = [...bytes.subarray(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
    sent.days!["2026-11-22"] = { hash, live: true, parts: { exercise: "answers" } };
    await saveSent(db, sent);
    expect(liveNote(fake, "2026-11-22")).toContain("Pretend Sablewick old answer");

    await sendToTogether({ fetch: fake.fetch, now: c.now, mode: "hide" });
    const now = liveNote(fake, "2026-11-22")!;
    expect(now).not.toContain("Sablewick");
    expect(now).not.toContain("What went well?");
    expect(now).toBe(dayNote([{ summary: days.exercise!.notes.get("2026-11-22")!.summary, text: days.exercise!.notes.get("2026-11-22")!.full }]));
    expect(now).toContain("Pretend learned words"); // the rest of the day as it was
  });
});
