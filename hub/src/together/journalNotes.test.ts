import { checkinSection, dayNote, exerciseSection, isNA, researchBullets } from "./journalNotes";

// The challenge note's layout (Esme, 2026-11-09): plain text, questions in `**bold**`, research
// notes as "• " bullets, n/a answers left out, empty parts left out. Made-up words only.

const CARD = "Pretend book · Day 3 · Pretend theme";

it("n/a in any case or punctuation; nothing else", () => {
  for (const a of ["n/a", "N/A", "na", "NA", "n.a", "n.a.", "N/A.", " n / a ", "n. a"]) expect(isNA(a)).toBe(true);
  for (const a of ["no", "nah", "n/a but", "a", "n", "", "none", "n//a"]) expect(isNA(a)).toBe(false);
});

it("the exercise part: title, research notes as bullets, then each question bold with her answer below", () => {
  const research = researchBullets("Pretend first thing\nPretend second thing\n\n  ", [
    { words: "pretend highlighted\nwords", note: "Pretend note" },
    { words: "pretend other words", note: "  " },
  ]);
  expect(research).toEqual(["Pretend first thing", "Pretend second thing", "pretend highlighted words — Pretend note", "pretend other words"]);
  const cards = [{ title: CARD, qas: [{ q: "", a: "Pretend free answer" }, { q: "Pretend question one", a: "Pretend answer one" }, { q: "Pretend question two", a: "N/A" }] }];
  expect(exerciseSection(cards, research, true)).toBe(
    [
      "Mental Health Exercise",
      CARD,
      "",
      "Research notes",
      "• Pretend first thing",
      "• Pretend second thing",
      "• pretend highlighted words — Pretend note",
      "• pretend other words",
      "",
      "Pretend free answer",
      "",
      "**Pretend question one**",
      "Pretend answer one",
    ].join("\n"),
  );
  // Titles and questions only: no answers, no research notes.
  expect(exerciseSection(cards, research, false)).toBe(`Mental Health Exercise\n${CARD}\n\n**Pretend question one**`);
});

it("two cards: both titles at the top, each card's answers under its title", () => {
  const cards = [
    { title: "Pretend card A", qas: [{ q: "Pretend qA", a: "Pretend aA" }] },
    { title: "Pretend card B", qas: [{ q: "", a: "Pretend aB" }] },
  ];
  expect(exerciseSection(cards, [], true)).toBe(
    "Mental Health Exercise\nPretend card A\nPretend card B\n\nPretend card A\n**Pretend qA**\nPretend aA\n\nPretend card B\nPretend aB",
  );
  expect(exerciseSection([], ["Pretend bullet"], true)).toBe(""); // no card done: nothing, not even research notes
});

it("the check-in part: heading, then each question bold with her answer; all n/a: left out", () => {
  const qas = [{ q: "Pretend Q1", a: "Pretend A1" }, { q: "Pretend Q2", a: "n.a." }, { q: "Pretend Q3", a: "Pretend A3\nline two" }];
  expect(checkinSection(qas, true)).toBe("Check In\n**Pretend Q1**\nPretend A1\n\n**Pretend Q3**\nPretend A3\nline two");
  expect(checkinSection(qas, false)).toBe("Check In\n**Pretend Q1**\n**Pretend Q3**");
  expect(checkinSection([{ q: "Pretend Q", a: "NA" }], true)).toBe("");
});

it("the day: both parts under their headings; an empty part left out; nothing at all: empty", () => {
  expect(dayNote(["Mental Health Exercise\nX", "Check In\n**Q**\nA"])).toBe("Mental Health Exercise\nX\n\nCheck In\n**Q**\nA");
  expect(dayNote(["", "Check In\n**Q**\nA"])).toBe("Check In\n**Q**\nA");
  expect(dayNote(["", ""])).toBe("");
});
