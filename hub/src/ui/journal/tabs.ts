/**
 * The Journal's tabs (Journal v2), in her order: the mental health exercise first. Each has
 * its own address; `/journal` opens the first.
 */
export const JOURNAL_TABS = [
  { id: "exercise", path: "/journal/exercise", title: "Mental health exercise" },
  // Weekly review v2 (Esme, 17 Nov 2026: "its own tab"): submitted as a Mental health exercise, so
  // next to it (PROVISIONAL place, for Design). Weekly, so no daily tick or streak of its own.
  { id: "weekly-review", path: "/journal/weekly-review", title: "Weekly review" },
  { id: "morning", path: "/journal/morning", title: "Morning pages" },
  { id: "check-in", path: "/journal/check-in", title: "Daily check-in" },
  { id: "read-back", path: "/journal/read-back", title: "Read back" },
  { id: "notes", path: "/journal/notes", title: "Notes to myself" },
] as const;

export type JournalTabId = (typeof JOURNAL_TABS)[number]["id"];

/**
 * The tabs that tick themselves and show a streak (Read back, Notes to myself and the weekly
 * review never do: a done review ticks the Mental health exercise's).
 */
export type TickingTabId = Exclude<JournalTabId, "read-back" | "notes" | "weekly-review">;
export const ticks = (id: JournalTabId): id is TickingTabId => id !== "read-back" && id !== "notes" && id !== "weekly-review";

export const tabPath = (id: JournalTabId): string => JOURNAL_TABS.find((t) => t.id === id)!.path;

/** Earlier links to a Journal section (`/journal#morning-pages`, …) and the tab each now is. */
export const TAB_FOR_HASH: Record<string, JournalTabId> = {
  "#morning-pages": "morning",
  "#daily-check-in": "check-in",
  "#mental-health-exercise": "exercise",
};

/**
 * A Journal part Read back shows (every tab but Read back itself, and her highlights). Weekly
 * reviews (both kinds) read back inside the Mental health exercise part, as before.
 */
export type ReadBackPart = Exclude<JournalTabId, "read-back" | "weekly-review"> | "highlights";

/**
 * Read back's parts (2026-11-05, option B): every tab with something to read back, in the
 * tabs' order, then Highlights. Each opens at `/journal/read-back?part=<id>`; with no part, the tiles.
 */
export const READ_BACK_PARTS = [
  ...(JOURNAL_TABS.filter((t) => t.id !== "read-back" && t.id !== "weekly-review") as { id: ReadBackPart; title: string }[]),
  // Highlights (2026-11-06): a fifth part after the tabs' four; its place is provisional (Design).
  { id: "highlights", title: "Highlights" },
] as { id: ReadBackPart; title: string }[];

/** Read back opened straight on one part ("See all" under Past exercises and Past check-ins). */
export const readBackPath = (part: ReadBackPart): string => `${tabPath("read-back")}?part=${part}`;
