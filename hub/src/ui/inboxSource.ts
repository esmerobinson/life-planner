import type { Item } from "../domain/types";

/** Where an inbox item came from, in the order the "From" pills are shown. */
export const INBOX_SOURCES = [
  "Backlog",
  "Google Tasks",
  "Daily notes",
  "Old task lists",
  "Projects",
  "Other",
] as const;
export type InboxSource = (typeof INBOX_SOURCES)[number];

/** Tags the transfer script puts on items it creates from the vault review. */
const TAG_SOURCE: Record<string, InboxSource> = {
  "from-daily-notes": "Daily notes",
  "from-old-task-lists": "Old task lists",
  "from-project-notes": "Projects",
};

/** The source of an item: a vault-review tag wins, then the source kind, else Other. */
export function inboxSource(item: Item): InboxSource {
  for (const t of item.tags ?? []) {
    const s = TAG_SOURCE[t];
    if (s) return s;
  }
  if (item.source?.kind === "backlog") return "Backlog";
  if (item.source?.kind === "gtasks") return "Google Tasks";
  return "Other";
}
