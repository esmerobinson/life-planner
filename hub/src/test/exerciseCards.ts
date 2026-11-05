// A FICTIONAL exercise card file for tests and screenshots only. Every word here is made
// up; no real card text (or anything from her book) may ever be in the repo.

export const FAKE_CARD_FILE = {
  app: "esmeworld",
  kind: "exercise-cards",
  version: 1,
  source: "A pretend workbook (test fixture)",
  cards: [
    {
      day: 1,
      theme: "Pretend weather",
      learn: "A made-up note: feelings drift past like *pretend* clouds over a made-up hill.",
      try: "Name one pretend cloud you can see right now, and let it float on.",
      book: "Pretend workbook, page 1",
      skill: "Made-up skill A",
      session: false,
    },
    {
      day: 2,
      theme: "The fictional kettle",
      learn: "A made-up note: a kettle whistles before it boils over. Pretend bodies do too.",
      try: "Notice one pretend whistle in your body today.",
      book: "Pretend workbook, page 2",
      skill: "",
      session: true,
    },
    {
      day: 3,
      theme: "Imaginary pebbles",
      learn: "A made-up note: one small pebble at a time builds a *pretend* path.",
      try: "Put one imaginary pebble down: one tiny kind thing.",
      book: "Pretend workbook, page 3",
      skill: "Made-up skill B",
      session: false,
    },
    {
      day: 4,
      theme: "A pretend lighthouse",
      learn: "A made-up note: a lighthouse doesn't chase the boats.",
      try: "Pick one pretend light to keep steady this evening.",
      book: "Pretend workbook, page 4",
      skill: "Made-up skill C",
      session: false,
    },
    {
      day: 5,
      theme: "The made-up garden",
      learn: "A made-up note: weeding a pretend garden is gentle work, a little each day.",
      try: "Pull one imaginary weed and leave the rest for another day.",
      book: "Pretend workbook, page 5",
      skill: "Made-up skill D",
      session: true,
    },
  ],
};

/** The fixture as the text of a file. */
export const FAKE_CARD_TEXT = JSON.stringify(FAKE_CARD_FILE);

/**
 * A FICTIONAL version 2 card file (Journal v2): stable ids, chapters, an optional Introduction
 * (not part of the daily sequence), and "Read more" with sources on some cards. Every word and
 * link here is made up (example.org links only).
 */
export const FAKE_CARD_FILE_V2 = {
  app: "esmeworld",
  kind: "exercise-cards",
  version: 2,
  source: "A pretend workbook, second edition (test fixture)",
  cards: [
    {
      id: "pretend-intro",
      day: null,
      chapter: 0,
      chapterTitle: "Before we begin",
      optional: true,
      theme: "Introduction",
      learn: "A made-up note: this pretend book is read a little at a time.",
      try: "Flip through the pretend contents page.",
      book: "Pretend workbook, introduction",
      skill: "",
      session: false,
    },
    {
      id: "pretend-ch1-weather",
      day: 1,
      chapter: 1,
      chapterTitle: "Pretend basics",
      optional: false,
      theme: "Pretend weather",
      learn: "A made-up note: feelings drift past like *pretend* clouds over a made-up hill.",
      try: "Name one pretend cloud you can see right now, and let it float on.",
      book: "Pretend workbook, page 1",
      skill: "Made-up skill A",
      session: false,
      more: "A made-up first paragraph about pretend clouds.\n\nA made-up second paragraph: clouds pass, hills stay.",
      sources: [
        { title: "Pretend Cloud Society: About clouds", url: "https://example.org/pretend-clouds" },
        { title: "Made-up Hill Trust", url: "https://example.org/made-up-hills" },
      ],
    },
    {
      id: "pretend-ch1-kettle",
      day: 2,
      chapter: 1,
      chapterTitle: "Pretend basics",
      optional: false,
      theme: "The fictional kettle",
      learn: "A made-up note: a kettle whistles before it boils over. Pretend bodies do too.",
      try: "Notice one pretend whistle in your body today.",
      book: "Pretend workbook, page 2",
      skill: "",
      session: true,
      parts: [
        { prompt: "What does your pretend whistle sound like?", kind: "text" },
        { prompt: "Three pretend places you feel it", kind: "list", count: 3 },
        { prompt: "How loud is it right now?", kind: "rating" },
        { prompt: "Which pretend kettle is it?", kind: "choice", options: ["Copper", "Tin", "Glass"] },
      ],
      example: "A made-up example: it sounds like a small pretend train.",
      bookExample: true,
    },
    {
      id: "pretend-ch2-pebbles",
      day: 3,
      chapter: 2,
      chapterTitle: "Pretend paths",
      optional: false,
      theme: "Imaginary pebbles",
      learn: "A made-up note: one small pebble at a time builds a *pretend* path.",
      try: "Put one imaginary pebble down: one tiny kind thing.",
      book: "Pretend workbook, page 3",
      skill: "Made-up skill B",
      session: false,
      more: "A made-up paragraph about pebbles.",
    },
    {
      id: "pretend-ch2-lighthouse",
      day: 4,
      chapter: 2,
      chapterTitle: "Pretend paths",
      optional: false,
      theme: "A pretend lighthouse",
      learn: "A made-up note: a lighthouse doesn't chase the boats.",
      try: "Pick one pretend light to keep steady this evening.",
      book: "Pretend workbook, page 4",
      skill: "Made-up skill C",
      session: false,
    },
  ],
};

/** The version 2 fixture as the text of a file. */
export const FAKE_CARD_TEXT_V2 = JSON.stringify(FAKE_CARD_FILE_V2);

const pretendCard = (id: string, day: number, theme: string, extra: Record<string, unknown> = {}) => ({
  id, day, chapter: 1, chapterTitle: "Pretend chapter", optional: false, theme,
  learn: `A made-up note for ${theme}.`, try: `A made-up thing to try for ${theme}.`, book: "Pretend book, page 1", skill: "", session: false,
  ...extra,
});

/**
 * A FICTIONAL two-book card file (Journal v2 tracks): a pretend first book and a pretend second
 * book, each numbered from Day 1, taken in turn. One card names no track (so it is the first's).
 */
export const FAKE_CARD_FILE_TRACKS = {
  app: "esmeworld",
  kind: "exercise-cards",
  version: 2,
  source: "Two pretend workbooks (test fixture)",
  tracks: [
    { id: "first", title: "Pretend first workbook" },
    { id: "second", title: "Pretend second workbook" },
  ],
  cards: [
    pretendCard("first-001", 1, "Pretend first one", { track: "first" }),
    pretendCard("first-002", 2, "Pretend first two"), // no track: the first book
    pretendCard("first-003", 3, "Pretend first three", { track: "first", chapter: 2, chapterTitle: "Pretend later chapter" }),
    pretendCard("second-001", 1, "Pretend second one", { track: "second" }),
    pretendCard("second-002", 2, "Pretend second two", { track: "second" }),
  ],
};

/**
 * A FICTIONAL file with one card of each newer part kind: a table, a scale, a tracker and a
 * chain (each card's `format` names it). Every word is made up.
 */
export const FAKE_CARD_FILE_KINDS = {
  app: "esmeworld",
  kind: "exercise-cards",
  version: 2,
  source: "A pretend workbook of shapes (test fixture)",
  cards: [
    pretendCard("kinds-table", 1, "Pretend table", {
      format: "Table",
      parts: [{ prompt: "Pretend feelings and what set them off", kind: "table", columns: ["Feeling", "Set off by"], rows: 2 }],
    }),
    pretendCard("kinds-scale", 2, "Pretend scale", {
      format: "Scale",
      parts: [{ prompt: "How pretend-calm are you?", kind: "scale", min: 1, max: 5, minLabel: "Not at all", maxLabel: "Very" }],
    }),
    pretendCard("kinds-tracker", 3, "Pretend tracker", {
      format: "Tracker",
      parts: [{ prompt: "Pretend sleep log", kind: "tracker", days: 3, fields: ["Hours", "Mood"] }],
    }),
    pretendCard("kinds-chain", 4, "Pretend chain", {
      format: "Chain",
      parts: [{ prompt: "A pretend chain of events", kind: "chain", steps: ["What set it off", "What I felt", "What I did"] }],
    }),
  ],
};

/**
 * A FICTIONAL file with checklist cards (a list of pretend things, each answered Yes / Partly /
 * No, with an optional note box) and a scale card with no end labels. Every word is made up.
 */
export const PRETEND_FEATURES = ["Pretend feature one", "Pretend feature two", "Pretend feature three", "Pretend feature four"];
export const FAKE_CARD_FILE_CHECKLIST = {
  app: "esmeworld",
  kind: "exercise-cards",
  version: 2,
  source: "A pretend workbook of checklists (test fixture)",
  cards: [
    pretendCard("check-notes", 1, "Pretend checklist", {
      format: "Checklist",
      parts: [
        {
          prompt: "Go through the pretend features in your made-up book. Does each one fit you?",
          kind: "checklist",
          items: PRETEND_FEATURES,
          options: ["Yes", "Partly", "No"],
          note: "An example (optional)",
        },
      ],
    }),
    pretendCard("check-plain", 2, "Pretend plain checklist", {
      parts: [{ prompt: "Which pretend things did you do today?", kind: "checklist", items: ["Pretend walk", "Pretend tea"], options: ["Done", "Not yet"], note: "" }],
    }),
    pretendCard("check-bare-scale", 3, "Pretend bare scale", {
      parts: [{ prompt: "How pretend-calm are you?", kind: "scale", min: 1, max: 5 }],
    }),
  ],
};

/**
 * A FICTIONAL two-book file shaped like hers (the books' ids "bpd" and "dbt", each in chapters):
 * every title and word is made up. The first book has 4 days in 2 chapters; the second 3 cards
 * in 2 chapters; plus one optional reading card (never counted).
 */
export const FAKE_CARD_FILE_BOOKS = {
  app: "esmeworld",
  kind: "exercise-cards",
  version: 2,
  source: "Two pretend workbooks in chapters (test fixture)",
  tracks: [
    { id: "bpd", title: "Pretend first workbook" },
    { id: "dbt", title: "Pretend second workbook" },
  ],
  cards: [
    pretendCard("b-intro", 1, "Pretend introduction", { track: "bpd", day: null, optional: true, chapter: 0, chapterTitle: "Pretend start" }),
    pretendCard("b-001", 1, "Pretend first-book one", { track: "bpd", chapter: 1, chapterTitle: "Pretend meadow" }),
    pretendCard("b-002", 2, "Pretend first-book two", { track: "bpd", chapter: 1, chapterTitle: "Pretend meadow" }),
    pretendCard("b-003", 3, "Pretend first-book three", { track: "bpd", chapter: 2, chapterTitle: "Pretend river" }),
    pretendCard("b-004", 4, "Pretend first-book four", { track: "bpd", chapter: 2, chapterTitle: "Pretend river" }),
    pretendCard("d-001", 1, "Pretend second-book one", { track: "dbt", chapter: 1, chapterTitle: "Pretend hilltop" }),
    pretendCard("d-002", 2, "Pretend second-book two", { track: "dbt", chapter: 2, chapterTitle: "Pretend valley" }),
    pretendCard("d-003", 3, "Pretend second-book three", { track: "dbt", chapter: 2, chapterTitle: "Pretend valley" }),
  ],
};

/** The books fixture as the text of a file. */
export const FAKE_CARD_TEXT_BOOKS = JSON.stringify(FAKE_CARD_FILE_BOOKS);
