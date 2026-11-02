/**
 * The Journal's tabs (Journal v2), in her order: the mental health exercise first. Each has
 * its own address; `/journal` opens the first.
 */
export const JOURNAL_TABS = [
  { id: "exercise", path: "/journal/exercise", title: "Mental health exercise" },
  { id: "morning", path: "/journal/morning", title: "Morning pages" },
  { id: "check-in", path: "/journal/check-in", title: "Daily check-in" },
  { id: "read-back", path: "/journal/read-back", title: "Read back" },
] as const;

export type JournalTabId = (typeof JOURNAL_TABS)[number]["id"];

export const tabPath = (id: JournalTabId): string => JOURNAL_TABS.find((t) => t.id === id)!.path;

/** Earlier links to a Journal section (`/journal#morning-pages`, …) and the tab each now is. */
export const TAB_FOR_HASH: Record<string, JournalTabId> = {
  "#morning-pages": "morning",
  "#daily-check-in": "check-in",
  "#mental-health-exercise": "exercise",
};
