// The "What did you do?" box's words, kept on this device at every key (localStorage: written at
// once, so a closed tab, the phone ending the app or the Mac's update loses nothing, even the
// last second). One draft per note (review M5). Forgotten once the same words are saved, or when
// the box is back to what is saved. A draft left behind is saved on the next start ONLY when it
// differs from the saved note AND was typed after the to-do last changed, with its own typed-at
// time as the stamp, never "now" (review C1): newer words or edits from another device always win.

import { keepOwnStamps } from "./changeTracking";
import { db } from "./db";
import { withDidEntry } from "../domain/whatIDid";
import type { DidEntry } from "../domain/types";

const PREFIX = "esmeworld-what-i-did:";
const keyOf = (itemId: string, entryId: string) => `${PREFIX}${itemId}:${entryId}`;

export interface DidDraft {
  itemId: string;
  at: Pick<DidEntry, "id" | "on" | "session">;
  text: string;
  /** When the last key was typed (epoch ms). */
  typedAt: number;
}

function parse(raw: string | null): DidDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<DidDraft>;
    const at = d.at as Partial<DidEntry> | undefined;
    if (typeof d.itemId !== "string" || typeof d.text !== "string" || typeof d.typedAt !== "number" || !Number.isFinite(d.typedAt)) return null;
    if (!at || typeof at.id !== "string" || typeof at.on !== "string") return null;
    return { itemId: d.itemId, at: { id: at.id, on: at.on, ...(typeof at.session === "string" ? { session: at.session } : {}) }, text: d.text, typedAt: d.typedAt };
  } catch {
    return null;
  }
}

/** One note's kept draft, or null (none, unreadable, or storage blocked). */
export function readDidDraft(itemId: string, entryId: string): DidDraft | null {
  try {
    return parse(localStorage.getItem(keyOf(itemId, entryId)));
  } catch {
    return null;
  }
}

/** Keeps the words being typed (storage blocked: they live as long as the page). */
export function keepDidDraft(d: DidDraft): void {
  try {
    localStorage.setItem(keyOf(d.itemId, d.at.id), JSON.stringify(d));
  } catch {
    // A private window or blocked storage.
  }
}

/** Forgets a note's draft. */
export function forgetDidDraft(itemId: string, entryId: string): void {
  try {
    localStorage.removeItem(keyOf(itemId, entryId));
  } catch {
    // Blocked storage: nothing was kept.
  }
}

/** Forgets the draft once exactly these words are saved on that note. */
export function clearDidDraft(itemId: string, entryId: string, saved: string): void {
  const d = readDidDraft(itemId, entryId);
  if (d && d.text === saved) forgetDidDraft(itemId, entryId);
}

/** Every kept draft on this device. */
function allDrafts(): DidDraft[] {
  try {
    const out: DidDraft[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const d = parse(localStorage.getItem(k));
      if (d) {
        out.push(d);
      } else {
        localStorage.removeItem(k); // unreadable: never useful
        i--;
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * On start: each draft left behind is saved on its note only if its words differ from the saved
 * note and it was typed after the to-do last changed (its stamp), stamped with when it was typed.
 * An empty draft, one that matches, or an older one is just forgotten: the to-do is not written.
 */
export async function recoverDidDraft(): Promise<void> {
  for (const d of allDrafts()) {
    await db.transaction("rw", db.items, db.syncMeta, db.pending, async () => {
      const item = await db.items.get(d.itemId);
      if (!item || item.status === "deleted" || item.status === "purged") return;
      const saved = item.did?.find((e) => e.id === d.at.id)?.note ?? "";
      if (d.text.trim() === "" || d.text === saved || !(d.typedAt > (item.updatedAt ?? 0))) return;
      const did = withDidEntry(item.did, d.at, { note: d.text });
      const { did: _d, ...rest } = item;
      keepOwnStamps(); // the draft's own time, never "now"
      await db.items.put({ ...rest, ...(did ? { did } : {}), updatedAt: d.typedAt });
    });
    forgetDidDraft(d.itemId, d.at.id);
  }
}
