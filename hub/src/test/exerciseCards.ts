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
