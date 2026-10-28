// Vault-review items for the transfer script (--extra). Pure parsing, no I/O.
import { isValidISODate } from "../src/domain/dates";
import { AREA_IDS, type AreaId, type Goal, type ISODate, type Item } from "../src/domain/types";
import type { ParseNote } from "../src/import/obsidianGoals";

const AREA_LIST: readonly string[] = AREA_IDS;

const EXTRA_TAGS = ["from-daily-notes", "from-old-task-lists", "from-project-notes"];
const EXTRA_KINDS = ["task", "idea", "goal"];

/**
 * Vault-review items, one JSON object per line:
 * `{ key, title, notes?, due?, kind: "task"|"idea"|"goal", areaId, tag, check? }`.
 * `tag` is one of from-daily-notes, from-old-task-lists, from-project-notes. An optional
 * `check` reason adds the `check` tag and a first notes line "Check: <reason>". A goal is a
 * practice goal (deadline only if `due` is given) and must not be in the inbox. Bad lines are
 * reported by number and skipped; nothing here ever throws.
 */
export function parseExtra(
  text: string,
  today: ISODate,
): { entries: { line: number; key: string; item?: Item; goal?: Goal }[]; notes: ParseNote[] } {
  const entries: { line: number; key: string; item?: Item; goal?: Goal }[] = [];
  const notes: ParseNote[] = [];
  const bad = (n: number, why: string) => notes.push({ line: "", reason: `extra line ${n}: ${why}, skipped` });
  text.split(/\r?\n/).forEach((raw, idx) => {
    const n = idx + 1;
    if (!raw.trim()) return;
    let o: unknown;
    try {
      o = JSON.parse(raw);
    } catch {
      return bad(n, "not valid JSON");
    }
    if (typeof o !== "object" || o === null || Array.isArray(o)) return bad(n, "not an object");
    const r = o as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const key = str(r.key)?.trim();
    const title = str(r.title)?.replace(/\s+/g, " ").trim();
    if (!key) return bad(n, "no key");
    if (!title) return bad(n, "no title");
    if (!EXTRA_KINDS.includes(r.kind as string)) return bad(n, "kind must be task, idea or goal");
    if (typeof r.areaId !== "string" || !AREA_LIST.includes(r.areaId)) return bad(n, "unknown area");
    if (!EXTRA_TAGS.includes(r.tag as string)) return bad(n, "unknown tag");
    const kind = r.kind as "task" | "idea" | "goal";
    const areaId = r.areaId as AreaId;
    const due = r.due === undefined ? undefined : str(r.due);
    if (r.due !== undefined && !(due && isValidISODate(due))) return bad(n, "due is not a real date");
    if (r.notes !== undefined && typeof r.notes !== "string") return bad(n, "notes must be text");
    if (r.check !== undefined && typeof r.check !== "string") return bad(n, "check must be text");
    const notesText = str(r.notes)?.trim();
    if (kind === "goal") {
      if (areaId === "inbox") return bad(n, "a goal cannot be in the inbox");
      const goal: Goal = {
        id: crypto.randomUUID(),
        title,
        areaId,
        kind: "practice",
        milestones: [],
        source: { kind: "obsidian", key },
        createdAt: today,
      };
      if (due) goal.deadline = due;
      if (notesText) goal.notes = notesText;
      entries.push({ line: n, key, goal });
      return;
    }
    const check = str(r.check)?.trim();
    const item: Item = {
      id: crypto.randomUUID(),
      kind,
      title,
      links: [],
      tags: check ? [r.tag as string, "check"] : [r.tag as string],
      areaId,
      priority: 2,
      status: "open",
      createdAt: today,
      touchedAt: today,
      source: { kind: "obsidian", key },
    };
    const noteLines = [check ? `Check: ${check}` : "", notesText ?? ""].filter(Boolean);
    if (noteLines.length) item.notes = noteLines.join("\n");
    if (due) item.due = due;
    entries.push({ line: n, key, item });
  });
  return { entries, notes };
}

