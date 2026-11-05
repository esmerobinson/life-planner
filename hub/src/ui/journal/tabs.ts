/**
 * The Journal's tabs (Journal v2), in her order: the mental health exercise first. Each has
 * its own address; `/journal` opens the first.
 */
export const JOURNAL_TABS = [
  { id: "exercise", path: "/journal/exercise", title: "Mental health exercise" },
  { id: "morning", path: "/journal/morning", title: "Morning pages" },
  { id: "check-in", path: "/journal/check-in", title: "Daily check-in" },
  { id: "read-back", path: "/journal/read-back", title: "Read back" },
  { id: "notes", path: "/journal/notes", title: "Notes to myself" },
] as const;

export type JournalTabId = (typeof JOURNAL_TABS)[number]["id"];

/** The tabs that tick themselves and show a streak (Read back and Notes to myself never do). */
export type TickingTabId = Exclude<JournalTabId, "read-back" | "notes">;
export const ticks = (id: JournalTabId): id is TickingTabId => id !== "read-back" && id !== "notes";

export const tabPath = (id: JournalTabId): string => JOURNAL_TABS.find((t) => t.id === id)!.path;

/** Earlier links to a Journal section (`/journal#morning-pages`, …) and the tab each now is. */
export const TAB_FOR_HASH: Record<string, JournalTabId> = {
  "#morning-pages": "morning",
  "#daily-check-in": "check-in",
  "#mental-health-exercise": "exercise",
};

/** A Journal part Read back shows (every tab but Read back itself). */
export type ReadBackPart = Exclude<JournalTabId, "read-back">;

/**
 * Read back's parts (2026-11-05, option B): every tab with something to read back, in the
 * tabs' order. Each opens at `/journal/read-back?part=<id>`; with no part, the four tiles.
 */
export const READ_BACK_PARTS = JOURNAL_TABS.filter((t) => t.id !== "read-back") as { id: ReadBackPart; title: string }[];

/** Read back opened straight on one part ("See all" under Past exercises and Past check-ins). */
export const readBackPath = (part: ReadBackPart): string => `${tabPath("read-back")}?part=${part}`;
