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
