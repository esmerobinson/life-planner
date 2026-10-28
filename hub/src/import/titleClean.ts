// Title cleanup shared by the Backlog importer, the Google Tasks importer and the transfer
// script. Pure: no I/O. It removes noise that older tools wrote into titles, so the same
// task is recognised as one task wherever it came from.

/** Lowercase, letters and digits only, spaces collapsed: emoji and punctuation are ignored. */
export function normaliseTitle(title: string): string {
  return title
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** What a wiki-link inner text shows: the alias if there is one, else the page name. */
function display(inner: string): string {
  const alias = inner.includes("|")
    ? inner.slice(inner.lastIndexOf("|") + 1)
    : inner.split("#")[0].split("^")[0];
  return alias.trim();
}

/**
 * Replaces every wiki-link with its display text. Nested or malformed links (such as
 * `[[[[A - B|A]] - B|A]]`) collapse from the inside out, and any stray brackets left
 * over are removed. Never throws.
 */
export function unwikilink(s: string): string {
  let out = s;
  for (let i = 0; i < 50; i++) {
    const next = out.replace(/\[\[([^[\]]*)\]\]/g, (_m, inner: string) => display(inner));
    if (next === out) break;
    out = next;
  }
  return out.replace(/\[\[|\]\]/g, "");
}

// Suffixes the old sync and daily engine appended to titles.
const SUFFIX =
  /\s*\((from google tasks|overdue!?|due today|due in \d+\s*d|was due ([^)]*)|carried[^)]*)\)\s*$/i;

/**
 * Cleans a title: wiki-links become text, trailing old-engine suffixes are removed (several
 * in a row, any case), whitespace is collapsed. A suffix that carries a date is kept as a
 * notes line ("Was due 19 Jul", "Was overdue on import").
 */
export function cleanTitle(raw: string): { title: string; notes: string[] } {
  let title = unwikilink(raw).replace(/\s+/g, " ").trim();
  const notes: string[] = [];
  for (let i = 0; i < 20; i++) {
    const m = SUFFIX.exec(title);
    if (!m) break;
    const word = m[1].toLowerCase();
    let note: string | undefined;
    if (word.startsWith("overdue")) note = "Was overdue on import";
    else if (m[2] !== undefined && word.startsWith("was due")) note = `Was due ${m[2].trim()}`;
    if (note && !notes.includes(note)) notes.push(note);
    title = title.slice(0, m.index).trim();
  }
  return { title, notes };
}
