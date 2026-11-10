import type { CardPart } from "../journal/exercise";
import type { PartAnswer } from "../data/repo";
import { cardQAs, checkinSection, dayNote, exerciseSection, exerciseSummary, isNA, partAnswerText, researchBullets } from "./journalNotes";

// The challenge note's layout (Esme, 2026-11-09): a one-line summary first, "## " headings,
// questions in `**bold**`, research notes and list-like answers as "• " bullets, each part kind
// written readably from the card's part definition, n/a left out, empty parts left out. Made-up
// words only.

const CARD = "Pretend book · Day 3 · Pretend theme";
const ans = (kind: PartAnswer["kind"], answer: PartAnswer["answer"], prompt = "Pretend prompt"): PartAnswer => ({ prompt, kind, answer }) as PartAnswer;

it("n/a in any case or punctuation; nothing else", () => {
  for (const a of ["n/a", "N/A", "na", "NA", "n.a", "n.a.", "N/A.", " n / a ", "n. a"]) expect(isNA(a)).toBe(true);
  for (const a of ["no", "nah", "n/a but", "a", "n", "", "none", "n//a"]) expect(isNA(a)).toBe(false);
});

describe("each part kind, written readably", () => {
  it("text: as it is; n/a or empty: nothing", () => {
    expect(partAnswerText(ans("text", "  Pretend words\nline two "))).toBe("Pretend words\nline two");
    expect(partAnswerText(ans("text", "N/A"))).toBe("");
    expect(partAnswerText(ans("text", ""))).toBe("");
  });

  it("list: each line a bullet; empty and n/a lines left out", () => {
    expect(partAnswerText(ans("list", ["Pretend one", "", "n/a", "Pretend two"]))).toBe("• Pretend one\n• Pretend two");
    expect(partAnswerText(ans("list", ["", "na"]))).toBe("");
  });

  it("chain: each step named, empty steps skipped; without its steps, bullets of what she wrote", () => {
    const def: CardPart = { prompt: "Pretend prompt", kind: "chain", steps: ["Pretend first", "Pretend second", "Pretend third"] };
    expect(partAnswerText(ans("chain", ["Pretend A", "", "Pretend C"]), def)).toBe("• Pretend first: Pretend A\n• Pretend third: Pretend C");
    expect(partAnswerText(ans("chain", ["Pretend A", "", "Pretend C"]))).toBe("• Pretend A\n• Pretend C");
  });

  it("rating: N out of 10", () => {
    expect(partAnswerText(ans("rating", 7))).toBe("7 out of 10");
    expect(partAnswerText(ans("rating", 0))).toBe("0 out of 10");
    expect(partAnswerText(ans("rating", null))).toBe("");
  });

  it("scale: N out of max, with the ends' labels (empty ones left out); without its definition, the number", () => {
    const def: CardPart = { prompt: "Pretend prompt", kind: "scale", min: 1, max: 5, minLabel: "Pretend low", maxLabel: "Pretend high" };
    expect(partAnswerText(ans("scale", 4), def)).toBe("4 out of 5 (1 = Pretend low, 5 = Pretend high)");
    expect(partAnswerText(ans("scale", 4), { ...def, minLabel: "" })).toBe("4 out of 5 (5 = Pretend high)");
    expect(partAnswerText(ans("scale", 4), { ...def, minLabel: "", maxLabel: "" })).toBe("4 out of 5");
    expect(partAnswerText(ans("scale", 4))).toBe("4");
  });

  it("choice: the option chosen", () => {
    expect(partAnswerText(ans("choice", "Pretend option"))).toBe("Pretend option");
    expect(partAnswerText(ans("choice", null))).toBe("");
  });

  it("table: a bullet per row with something, each cell with its column; empty and n/a cells left out; no columns: cells alone", () => {
    const def: CardPart = { prompt: "Pretend prompt", kind: "table", columns: ["Pretend col A", "Pretend col B"], rows: 3 };
    const rows = [["Pretend a1", "Pretend b1"], ["", "n/a"], ["Pretend a3", ""]];
    expect(partAnswerText(ans("table", rows), def)).toBe("• Pretend col A: Pretend a1 · Pretend col B: Pretend b1\n• Pretend col A: Pretend a3");
    expect(partAnswerText(ans("table", rows))).toBe("• Pretend a1 · Pretend b1\n• Pretend a3");
  });

  it("tracker: a bullet per day with any value, each field named; without its fields, plain", () => {
    const def: CardPart = { prompt: "Pretend prompt", kind: "tracker", days: 3, fields: ["Pretend hours", "Pretend mood"] };
    const days = [["7", "Pretend ok"], ["", ""], ["", "Pretend low"]];
    expect(partAnswerText(ans("tracker", days), def)).toBe("• Day 1: Pretend hours: 7 · Pretend mood: Pretend ok\n• Day 3: Pretend mood: Pretend low");
    expect(partAnswerText(ans("tracker", days))).toBe("7 · Pretend ok\nPretend low");
  });

  it("checklist: a bullet per item with a choice or a note", () => {
    const rows = [["Pretend item 1", "Yes", "Pretend note"], ["Pretend item 2", "", ""], ["Pretend item 3", "No", ""], ["Pretend item 4", "", "Pretend only a note"]];
    expect(partAnswerText(ans("checklist", rows))).toBe("• Pretend item 1: Yes (Pretend note)\n• Pretend item 3: No\n• Pretend item 4: (Pretend only a note)");
  });

  it("a card's answers: each part matched to its definition by prompt and kind; an n/a or empty part skipped with its question", () => {
    const defs: CardPart[] = [
      { prompt: "Pretend scale q", kind: "scale", min: 0, max: 4, minLabel: "", maxLabel: "Pretend top" },
      { prompt: "Pretend text q", kind: "text" },
    ];
    const qas = cardQAs({ text: "", parts: [ans("text", "n/a", "Pretend text q"), ans("scale", 3, "Pretend scale q"), ans("list", [], "Pretend list q")] }, defs);
    expect(qas.filter((x) => x.a !== "")).toEqual([{ q: "Pretend scale q", a: "3 out of 4 (4 = Pretend top)" }]);
  });
});

it("the exercise part: ## heading, ## Research notes as bullets, then the card as a ### block with each question bold and her answer below", () => {
  const research = researchBullets("Pretend first thing\nPretend second thing\n\n  ", [
    { words: "pretend highlighted\nwords", note: "Pretend note" },
    { words: "pretend other words", note: "  " },
  ]);
  expect(research).toEqual(["Pretend first thing", "Pretend second thing", "pretend highlighted words — Pretend note", "pretend other words"]);
  const cards = [{ title: CARD, qas: [{ q: "", a: "Pretend free answer" }, { q: "Pretend question one", a: "Pretend answer one" }, { q: "Pretend question two", a: "N/A" }] }];
  expect(exerciseSection(cards, research, true)).toBe(
    [
      "## Mental Health Exercise",
      "",
      "## Research notes",
      "• Pretend first thing",
      "• Pretend second thing",
      "• pretend highlighted words — Pretend note",
      "• pretend other words",
      "",
      `### ${CARD}`,
      "Pretend free answer",
      "",
      "**Pretend question one**",
      "Pretend answer one",
    ].join("\n"),
  );
  // Titles and questions only: no answers, no research notes; the card's block keeps its title.
  expect(exerciseSection(cards, research, false)).toBe(`## Mental Health Exercise\n\n### ${CARD}\n**Pretend question one**`);
});

it("several cards: never listed under the heading; each its own ### block, blank lines between Q&As and between cards; a card with nothing kept keeps its title", () => {
  const cards = [
    { title: "Pretend card A", qas: [{ q: "Pretend qA1", a: "Pretend aA1" }, { q: "Pretend qA2", a: "Pretend aA2" }] },
    { title: "Pretend card B", qas: [{ q: "", a: "Pretend aB" }] },
    { title: "Pretend card C", qas: [{ q: "Pretend qC", a: "n/a" }] },
  ];
  expect(exerciseSection(cards, [], true)).toBe(
    [
      "## Mental Health Exercise",
      "",
      "### Pretend card A",
      "**Pretend qA1**",
      "Pretend aA1",
      "",
      "**Pretend qA2**",
      "Pretend aA2",
      "",
      "### Pretend card B",
      "Pretend aB",
      "",
      "### Pretend card C",
    ].join("\n"),
  );
  // A titles-only (or private) day: every card's title, with its questions.
  expect(exerciseSection(cards, ["Pretend bullet"], false)).toBe(
    "## Mental Health Exercise\n\n### Pretend card A\n**Pretend qA1**\n**Pretend qA2**\n\n### Pretend card B\n\n### Pretend card C",
  );
  expect(exerciseSection([], ["Pretend bullet"], true)).toBe(""); // no card done: nothing, not even research notes
});

it("the check-in part: ## heading, then each question bold with her answer; all n/a: left out", () => {
  const qas = [{ q: "Pretend Q1", a: "Pretend A1" }, { q: "Pretend Q2", a: "n.a." }, { q: "Pretend Q3", a: "Pretend A3\nline two" }];
  expect(checkinSection(qas, true)).toBe("## Check In\n**Pretend Q1**\nPretend A1\n\n**Pretend Q3**\nPretend A3\nline two");
  expect(checkinSection(qas, false)).toBe("## Check In\n**Pretend Q1**\n**Pretend Q3**");
  expect(checkinSection([{ q: "Pretend Q", a: "NA" }], true)).toBe("");
});

describe("the summary line (Together's list shows only the first line): a count, never the titles", () => {
  const ex = { summary: exerciseSummary(6), text: "## Mental Health Exercise\n\n### Pretend card A" };
  const ci = { summary: "Check In", text: "## Check In\n**Q**\nA" };

  it("1 exercise / N exercises", () => {
    expect(exerciseSummary(1)).toBe("1 exercise");
    expect(exerciseSummary(6)).toBe("6 exercises");
    expect(exerciseSummary(0)).toBe("");
  });
  it("cards only: N exercises", () => {
    expect(dayNote([ex, { summary: "Check In", text: "" }]).split("\n")[0]).toBe("6 exercises");
  });
  it("check-in only: Check In", () => {
    expect(dayNote([{ summary: "", text: "" }, ci])).toBe("Check In\n\n## Check In\n**Q**\nA");
  });
  it("both: N exercises · Check In; one line, no titles, no answers", () => {
    const note = dayNote([ex, ci]);
    expect(note).toBe(`6 exercises · Check In\n\n${ex.text}\n\n${ci.text}`);
    expect(note.split("\n")[0]).not.toContain("Pretend card A");
    expect(note.split("\n")[1]).toBe("");
  });
  it("nothing at all: empty", () => {
    expect(dayNote([{ summary: "x", text: " " }])).toBe("");
  });
});
