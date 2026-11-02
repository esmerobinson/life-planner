// A GENERATED, FICTIONAL full-size card file for size tests: two pretend books (154 + 91
// cards), every card with Read more, four example.org sources, twelve parts (tables, scales,
// trackers, chains, lists of 25…) and an example. Not one real word; about 950 KB of JSON.

const words = (n: number, w: string) => Array.from({ length: n }, (_, i) => `${w}${i % 7}`).join(" ");

function card(track: string, i: number) {
  const parts = Array.from({ length: 12 }, (_, j) => {
    const prompt = words(5, "prompt");
    switch (j % 6) {
      case 0:
        return { prompt, kind: "text" };
      case 1:
        return { prompt, kind: "list", count: 25 };
      case 2:
        return { prompt, kind: "table", columns: ["Pretend one", "Pretend two", "Pretend three"], rows: 8 };
      case 3:
        return { prompt, kind: "scale", min: 0, max: 10, minLabel: "Pretend low", maxLabel: "Pretend high" };
      case 4:
        return { prompt, kind: "tracker", days: 7, fields: ["Pretend a", "Pretend b"] };
      default:
        return { prompt, kind: "chain", steps: ["Pretend step 1", "Pretend step 2", "Pretend step 3", "Pretend step 4"] };
    }
  });
  return {
    id: `${track}-ch${String(1 + Math.floor(i / 10)).padStart(2, "0")}-${String(i + 1).padStart(3, "0")}`,
    track, day: i + 1, chapter: 1 + Math.floor(i / 10), chapterTitle: "A pretend chapter title", optional: false,
    theme: `Pretend theme ${i + 1}`, format: "Table", learn: words(45, "learn"), try: words(30, "try"),
    book: "Pretend workbook, page 12", skill: "Made-up skill", session: i % 3 === 0,
    more: words(220, "m’"), // ~200 words, with non-ASCII punctuation
    sources: Array.from({ length: 4 }, (_, j) => ({ title: `Pretend source ${j}`, url: `https://example.org/pretend/${track}/${i}/${j}` })),
    parts, example: words(60, "ex"), bookExample: i % 2 === 0,
  };
}

/** The generated file's text. */
export function bigCardFileText(): string {
  return JSON.stringify({
    app: "esmeworld",
    kind: "exercise-cards",
    version: 2,
    source: "Two pretend workbooks, full size (generated test fixture)",
    tracks: [
      { id: "first", title: "Pretend first workbook" },
      { id: "second", title: "Pretend second workbook" },
    ],
    cards: [...Array.from({ length: 154 }, (_, i) => card("first", i)), ...Array.from({ length: 91 }, (_, i) => card("second", i))],
  });
}
