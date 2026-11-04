// Esme's Farm: the 170 stickers, read from the art pack's manifest (book order), each with the
// rule that earns it (game design v2's milestone table, tmp/game-design.md section 7). The
// rule is derived from the manifest's own `earned_by` and `milestone`, so the book, the
// hints and the earning can never disagree.

import rawManifest from "../assets/farm/manifest.json";
import type { AreaId } from "../domain/types";

// ---- the manifest's shape (only what the app reads) ----------------------------------------

export interface ManifestSticker {
  index: number;
  key: string;
  name: string;
  group: string;
  set: string;
  earned_by: string;
  milestone: number | string;
  tier: "everyday" | "special" | "bonus";
  /** False for a bonus sticker (not in the 175). */
  counts_toward_total?: boolean;
  /** Earned again and again (a ×N badge). */
  repeatable?: boolean;
}
export interface ManifestTag { name: string; from: number; to: number }
export interface ManifestAsset {
  name: string;
  png: string;
  frame: [number, number];
  frames: number;
  tags: ManifestTag[];
  [extra: string]: unknown;
}
export interface BookSlot { sticker: string; name: string; x: number; y: number; set: string; milestone: number | string }
export interface BookLabel { set: string; x: number; y: number; count_x: number; earned_by: string }
export interface BookPage { page: number; side: "left" | "right"; group: string | null; slots: BookSlot[]; labels: BookLabel[] }
export interface Manifest {
  palette: Record<string, string>;
  assets: ManifestAsset[];
  farm_character_spots: Record<string, { zone: string; frame_topleft: [number, number] }>;
  arrivals: { character: string; at_stickers: number; home: string; hosts: string }[];
  nook_hosts: Record<string, string>;
  book: { groups: string[]; spread: [number, number] };
}

export const MANIFEST = rawManifest as unknown as Manifest;

export function asset(name: string): ManifestAsset {
  const a = MANIFEST.assets.find((x) => x.name === name);
  if (!a) throw new Error(`The art pack has no ${name}`);
  return a;
}

/** The frame range of a tag in an asset. */
export function tagFrames(name: string, tag: string): number[] {
  const t = asset(name).tags.find((x) => x.name === tag);
  if (!t) return [];
  return Array.from({ length: t.to - t.from + 1 }, (_, i) => t.from + i);
}

// ---- sources and rules ---------------------------------------------------------------------

/**
 * What a sticker counts. Every one is a TOTAL since the farm's start (never a run): "days",
 * "weeks", "mornings" count each once, however much was done that day.
 */
export type Source =
  | `todos:${Exclude<AreaId, "inbox">}`
  | "today-finished" | "habit-weeks" | "habit-sessions" | "habit-months" | "habit-full-month" | "habit-run" | `cleared:${Exclude<AreaId, "inbox">}`
  | "monthly-goals" | "whole-goals" | "projects"
  | "morning-pages" | "checkins" | "exercise-days" | "chapters" | "workbook:dbt" | "workbook:bpd"
  | "weekly-reviews" | "monthly-reviews" | "reading-books"
  | "started" | "returns" | "late-ticks" | "short-pages" | "checkin-after-gap" | "habit-after-week-off"
  | `month:${string}`;

/** Journal-derived: only counted while the journal key is confirmed on this device. */
export const JOURNAL_SOURCES: ReadonlySet<Source> = new Set<Source>([
  "morning-pages", "checkins", "exercise-days", "chapters", "workbook:dbt", "workbook:bpd", "short-pages", "checkin-after-gap",
]);

/** Sources whose part of the app isn't built yet: their stickers are defined but not earnable. */
export const NOT_BUILT: ReadonlySet<Source> = new Set<Source>(["weekly-reviews", "monthly-reviews"]);

export interface Rule { source: Source; at: number }

const BY_UNIT: Record<string, Source> = {
  "days Today's list finished": "today-finished",
  "weeks with a habit ticked": "habit-weeks",
  "habit sessions": "habit-sessions",
  "habit months finished": "habit-months",
  "monthly goals hit": "monthly-goals",
  "whole goals completed": "whole-goals",
  "mornings with morning pages": "morning-pages",
  "days checked in": "checkins",
  "days with a mental health exercise (1/day)": "exercise-days",
  "workbook chapters (34: BPD 22, DBT 12)": "chapters",
  "weekly reviews": "weekly-reviews",
  "monthly reviews": "monthly-reviews",
  "Reading-list books": "reading-books",
  "projects finished": "projects",
};

const KIND_NOTES: Record<string, Rule> = {
  "day one": { source: "started", at: 1 },
  "3+ days away": { source: "returns", at: 1 },
  "3rd return": { source: "returns", at: 3 },
  "5th return": { source: "returns", at: 5 },
  "a late tick": { source: "late-ticks", at: 1 },
  "short pages": { source: "short-pages", at: 1 },
  "check-in after a gap": { source: "checkin-after-gap", at: 1 },
  "habit again after a week off": { source: "habit-after-week-off", at: 1 },
};

/** The "Seasons kept" set's unit in the manifest. */
export const SEASONS_KEPT_UNIT = "a habit kept: 100% of a month, or months in a row at 80%+";
export const SEASONS_KEPT_SET = "Seasons kept";

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** The rule for one manifest sticker. Throws for one it can't read (caught by the tests). */
export function ruleOf(s: Pick<ManifestSticker, "earned_by" | "milestone"> & { key?: string }): Rule {
  // "Area cleared" (bonus, repeatable): one per area, by its key (cleared-<area>).
  const cleared = s.key ? /^cleared-(\w+)$/.exec(s.key) : null;
  if (cleared && /^every task due in that area/.test(s.earned_by)) return { source: `cleared:${cleared[1]}` as Source, at: 1 };
  const area = /^to-dos in (\w+)$/.exec(s.earned_by);
  if (area && typeof s.milestone === "number") return { source: `todos:${area[1]!.toLowerCase()}` as Source, at: s.milestone };
  if (s.earned_by === "a whole workbook finished") {
    if (s.milestone === "DBT done") return { source: "workbook:dbt", at: 1 };
    if (s.milestone === "BPD done") return { source: "workbook:bpd", at: 1 };
  }
  if (s.earned_by === "each once" && typeof s.milestone === "string" && KIND_NOTES[s.milestone]) return KIND_NOTES[s.milestone]!;
  // "Seasons kept" (Esme, 2026-11-04: "a special sticker for a whole month … a special 2 month
  // one, 3 month one, you don't keep earning a 1 month one"): each earned once, ever.
  if (s.earned_by === SEASONS_KEPT_UNIT) {
    if (s.milestone === "100% month") return { source: "habit-full-month", at: 1 };
    const run = typeof s.milestone === "string" ? /^(\d+) months 80%\+$/.exec(s.milestone) : null;
    if (run) return { source: "habit-run", at: Number(run[1]) };
  }
  if (s.earned_by === "did anything that month" && (MONTHS as readonly unknown[]).includes(s.milestone)) {
    return { source: `month:${s.milestone}`, at: 1 };
  }
  const unit = BY_UNIT[s.earned_by];
  if (unit && typeof s.milestone === "number") return { source: unit, at: s.milestone };
  throw new Error(`No rule for "${s.earned_by}" at ${String(s.milestone)}`);
}

// ---- the stickers --------------------------------------------------------------------------

export interface Sticker {
  /** Its frame in the stickers / stickers-ghost / stickers-diecut sheets (book order). */
  index: number;
  key: string;
  name: string;
  group: string;
  set: string;
  earnedBy: string;
  milestone: number | string;
  rule: Rule;
  /** Counted only with the journal open on this device. */
  journal: boolean;
  /** Its part of the app isn't built yet. */
  later: boolean;
  /**
   * A bonus sticker (the pack's counts_toward_total: false): outside the 175 she completes, the
   * arrivals and the accessory thresholds (Esme, 2026-11-04).
   */
  bonus: boolean;
}

const rawStickers = (asset("stickers") as unknown as { stickers: ManifestSticker[] }).stickers;

const AREA_NAMES_BY_ID: Record<string, string> = {
  mind: "Mind", writing: "Writing", art: "Art", content: "Content", body: "Body", tech: "Tech", production: "Production", admin: "Admin",
};

/** Every sticker, in book order: the 175 of the collection, then the 8 bonus "Area cleared". */
export const STICKERS: readonly Sticker[] = rawStickers.map((s) => {
  const rule = ruleOf(s);
  const area = /^cleared-(\w+)$/.exec(s.key)?.[1];
  return {
    index: s.index, key: s.key, name: area ? `${AREA_NAMES_BY_ID[area] ?? area}: area cleared` : s.name, group: s.group, set: s.set,
    earnedBy: s.earned_by, milestone: s.milestone, rule, journal: JOURNAL_SOURCES.has(rule.source), later: NOT_BUILT.has(rule.source),
    bonus: s.counts_toward_total === false,
  };
});

/** The collection she completes (bonus stickers aside): 175, the manifest's total_for_completion. */
export const COLLECTION: readonly Sticker[] = STICKERS.filter((s) => !s.bonus);

/**
 * Stickers earned again and again show a ×N badge (Esme, 2026-11-04): each "Area cleared" (the
 * pack's repeatable ones) every month that area is cleared, and Full month for each habit's first
 * full month. N comes from the data, never stored increments.
 */
export const REPEATS: Readonly<Record<string, Source>> = Object.fromEntries([
  ["full-month", "habit-full-month"],
  ...rawStickers.filter((s) => s.repeatable).map((s) => [s.key, ruleOf(s).source]),
]);

export const STICKER_BY_KEY: ReadonlyMap<string, Sticker> = new Map(STICKERS.map((s) => [s.key, s]));

/** The farm's ten zones, in book order (the book's "bonus" group is a page, not a zone). */
export const GROUPS: readonly string[] = MANIFEST.book.groups.filter((g) => g !== "bonus");

/** A zone's stickers in the collection (bonus stickers aside). */
export const stickersIn = (group: string): Sticker[] => COLLECTION.filter((s) => s.group === group);

// ---- gentle hints ("how to earn it") -------------------------------------------------------
// PLACEHOLDER WORDING: built from the manifest's metadata; Esme words these.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const AREA_NAMES: Record<string, string> = {
  mind: "Mind", writing: "Writing", art: "Art", content: "Content", body: "Body", tech: "Tech", production: "Production", admin: "Admin",
};
const MONTH_NAMES: Record<string, string> = {
  Jan: "January", Feb: "February", Mar: "March", Apr: "April", May: "May", Jun: "June",
  Jul: "July", Aug: "August", Sep: "September", Oct: "October", Nov: "November", Dec: "December",
};

export function hintFor(s: Sticker): string {
  const { source, at } = s.rule;
  if (source.startsWith("todos:")) return `${plural(at, "to-do")} ticked off in ${AREA_NAMES[source.slice(6)]}`;
  if (source.startsWith("month:")) return `Anything at all in ${MONTH_NAMES[source.slice(6)]}`;
  const later = " (this part of the app is coming later)";
  switch (source) {
    case "today-finished": return `Everything on the day's list on Home done, on ${plural(at, "day")}`;
    case "habit-weeks": return `${plural(at, "week")} with a habit ticked`;
    case "habit-sessions": return plural(at, "habit session");
    case "habit-months": return `${plural(at, "month")} with most of a habit's sessions done`;
    case "habit-full-month": return "Every planned session of a habit in one month";
    case "habit-run": return `${at} months one after another with most of a habit's sessions done`;
    case "monthly-goals": return `${plural(at, "monthly goal")} reached`;
    case "whole-goals": return `${plural(at, "goal")} completed`;
    case "projects": return `${plural(at, "project")} finished`;
    case "morning-pages": return `Morning pages on ${plural(at, "morning")}`;
    case "checkins": return `Checked in on ${plural(at, "day")}`;
    case "exercise-days": return `A mental health exercise on ${plural(at, "day")}`;
    case "chapters": return plural(at, "workbook chapter");
    case "workbook:dbt": return "The whole DBT workbook";
    case "workbook:bpd": return "The whole BPD workbook";
    case "weekly-reviews": return `${plural(at, "weekly review")}${later}`;
    case "monthly-reviews": return `${plural(at, "monthly review")}${later}`;
    case "reading-books": return `${plural(at, "book")} from the reading list finished`;
    case "started": return "Opening the farm";
    case "returns":
      return at === 1 ? "Coming back after a few days away" : at === 3 ? "Coming back a third time" : "Coming back a fifth time";
    case "late-ticks": return "Ticking something off after its due date";
    case "short-pages": return "A short morning page";
    case "checkin-after-gap": return "A check-in after a break";
    case "habit-after-week-off": return "A habit again after a week off";
    default:
      if (source.startsWith("cleared:")) return `Every to-do due in ${AREA_NAMES[source.slice(8)]} in a month, done by the month's end`;
      return s.earnedBy;
  }
}
