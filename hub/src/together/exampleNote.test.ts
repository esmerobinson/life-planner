import { writeFileSync } from "node:fs";
import { db } from "../data/db";
import { cardRef, ensureCheckinSet, importExerciseCards, saveAnswer, saveLearned, saveSharePrivate, submitExerciseEntry, type PartAnswer } from "../data/repo";
import { parseCardFile } from "../journal/exercise";
import { PROMPTS } from "../journal/prompts";
import { FAKE_CARD_FILE_ALL_PARTS } from "../test/exerciseCards";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { sendToTogether } from "./sender";
import { clock, DEVICE, emptyDb, guardedFetch, highlightOn, liveNote, send, signedIn } from "./testKit";

// A full made-up day as Together gets it (Esme's rulings, 2026-11-09): one card asking for every
// part kind, research notes (her words and two highlights), and a check-in with one n/a answer.
// With EXAMPLE_NOTE_OUT set to a file path (outside the repo), the note is also written there
// for Esme to read. Every word is made up.

const DAY = "2026-11-04";
const TITLE = "Day 1 · Pretend noticing the wave";

beforeEach(emptyDb);

async function exampleDay() {
  const jk = await keyFor("fake-journal-together");
  await confirmedDevice(db, jk);
  const set = parseCardFile(JSON.stringify(FAKE_CARD_FILE_ALL_PARTS))!;
  await importExerciseCards(jk, set, DAY);
  const card = set.cards[0]!;
  const answers: PartAnswer["answer"][] = [
    "Pretend: a message wasn't answered and the feeling rose fast.\nThen it eased after a while.",
    ["Pretend chest", "Pretend jaw", "n/a"],
    [["Pretend worry", "Pretend unanswered message", "8"], ["Pretend shame", "Pretend an old memory", "n/a"], ["n/a", "n/a", "n/a"]],
    3,
    [["6", "Pretend tired"], ["n/a", "n/a"], ["8", "Pretend steady"]],
    ["Pretend unanswered message", "Pretend panic, then sadness", "n/a"],
    [["Pretend paced breathing", "Yes", "Pretend it slowed things down"], ["Pretend cold water", "No", ""], ["Pretend half smile", "Partly", ""]],
    6,
    "Rest",
  ];
  const parts = card.parts.map((p, i) => ({ prompt: p.prompt, kind: p.kind, answer: answers[i]! }) as PartAnswer);
  await submitExerciseEntry(jk, DAY, DEVICE, cardRef(card), parts);
  await saveLearned(jk, DAY, DEVICE, "Pretend: a feeling is a wave, it rises and falls.\nPretend: naming it makes it smaller.");
  await highlightOn(DAY, "pretend the wave passes", "Pretend this helped me most");
  await new Promise((r) => setTimeout(r, 5));
  await highlightOn(DAY, "pretend name it to tame it");
  const qs = [PROMPTS[0]!, PROMPTS[1]!, PROMPTS[2]!];
  await ensureCheckinSet(jk, DAY, qs.map((q) => q.id));
  await saveAnswer(jk, DAY, qs[0]!.id, DEVICE, "Pretend: the fridge humming, a soft jumper, the window.", true);
  await saveAnswer(jk, DAY, qs[1]!.id, DEVICE, "N/A", true);
  await saveAnswer(jk, DAY, qs[2]!.id, DEVICE, "Pretend: mostly the future. Back in the room now.", true);
  return { jk, card, qs };
}

it("a full example day: summary line, ## headings, research notes, every part kind written readably, the check-in", async () => {
  const c = clock(`${DAY}T10:00:00`);
  const fake = await signedIn(c);
  const { card, qs } = await exampleDay();
  c.set("2026-11-06T03:30:00");
  await send(fake, c);
  const note = liveNote(fake, DAY)!;
  const out = process.env.EXAMPLE_NOTE_OUT;
  if (out) writeFileSync(out, `${note}\n`);
  const P = card.parts.map((p) => `**${p.prompt}**`);
  expect(note).toBe(
    [
      `${TITLE} · Check In`,
      "",
      "## Mental Health Exercise",
      TITLE,
      "",
      "## Research notes",
      "• Pretend: a feeling is a wave, it rises and falls.",
      "• Pretend: naming it makes it smaller.",
      "• pretend the wave passes — Pretend this helped me most",
      "• pretend name it to tame it",
      "",
      P[0],
      "Pretend: a message wasn't answered and the feeling rose fast.",
      "Then it eased after a while.",
      "",
      P[1],
      "• Pretend chest",
      "• Pretend jaw",
      "",
      P[2],
      "• Feeling: Pretend worry · Set off by: Pretend unanswered message · How strong: 8",
      "• Feeling: Pretend shame · Set off by: Pretend an old memory",
      "",
      P[3],
      "3 out of 5 (1 = Not at all, 5 = Very)",
      "",
      P[4],
      "• Day 1: Hours: 6 · Mood: Pretend tired",
      "• Day 3: Hours: 8 · Mood: Pretend steady",
      "",
      P[5],
      "• What set it off: Pretend unanswered message",
      "• What I felt: Pretend panic, then sadness",
      "",
      P[6],
      "• Pretend paced breathing: Yes (Pretend it slowed things down)",
      "• Pretend cold water: No",
      "• Pretend half smile: Partly",
      "",
      P[7],
      "6 out of 10",
      "",
      P[8],
      "Rest",
      "",
      "## Check In",
      `**${qs[0]!.text}**`,
      "Pretend: the fridge humming, a soft jumper, the window.",
      "",
      `**${qs[2]!.text}**`,
      "Pretend: mostly the future. Back in the room now.",
    ].join("\n"),
  );
  expect(note).not.toContain(qs[1]!.text); // its answer was n/a
});

it("the same day, ticked private: the summary line stays; titles and questions only", async () => {
  const c = clock(`${DAY}T10:00:00`);
  const fake = await signedIn(c);
  const { jk, card, qs } = await exampleDay();
  await saveSharePrivate(jk, DAY, "exercise", true);
  await saveSharePrivate(jk, DAY, "checkin", true);
  c.set("2026-11-06T03:30:00");
  await send(fake, c);
  expect(liveNote(fake, DAY)).toBe(
    [`${TITLE} · Check In`, "", "## Mental Health Exercise", TITLE, "", ...card.parts.map((p) => `**${p.prompt}**`), "", "## Check In", `**${qs[0]!.text}**`, `**${qs[2]!.text}**`].join("\n"),
  );
  expect(JSON.stringify(fake.requests)).not.toMatch(/Pretend chest|Pretend worry|Research notes|wave passes|fridge humming/);
});

it("the recorder: of the card file, only the titles and the part definitions (prompts, columns, fields, steps, scale labels) of the card she did go", async () => {
  const c = clock(`${DAY}T10:00:00`);
  const fake = await signedIn(c);
  await exampleDay();
  const set = parseCardFile(JSON.stringify(FAKE_CARD_FILE_ALL_PARTS))!;
  const done = set.cards[0]!;
  const forbidden = [
    set.source, set.cards[1]!.theme,
    ...set.cards.flatMap((k) => [k.learn, k.try, k.more, k.example, k.book]),
    // Her card's own words she didn't pick: options not chosen, the checklist's note placeholder.
    "Talk to someone", "Go outside", done.parts.find((p) => p.kind === "checklist")!.note!,
  ].filter((s) => s && s.length > 3);
  const guard = guardedFetch(fake.fetch, () => forbidden, c.now);
  for (const at of ["2026-11-05T03:30:00", "2026-11-06T03:30:00"]) {
    c.set(at);
    expect(await sendToTogether({ fetch: guard.fetch, now: c.now })).toMatchObject({ kind: "ok" });
  }
  expect(guard.violations).toEqual([]);
  // Allowed, and there: every prompt, column, field, step and scale label of the card she did.
  const note = liveNote(fake, DAY)!;
  for (const p of done.parts) {
    for (const w of [p.prompt, ...(p.columns ?? []), ...(p.fields ?? []), ...(p.steps ?? []), p.minLabel ?? "", p.maxLabel ?? ""]) {
      if (w && w !== "What I did") expect(note).toContain(w); // (that step's answer was n/a: skipped)
    }
  }
  expect(note).not.toContain("What I did");
});
