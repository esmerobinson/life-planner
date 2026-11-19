// The "What did you do?" box's words, kept on this device as she types (localStorage: written at
// once, so a closed tab, the phone ending the app or the Mac's update loses nothing, even the
// last second). Forgotten once the same words are saved on the to-do; a draft left behind is
// saved on the next start (recoverDidDraft).

import type { DidEntry, ISODate } from "../domain/types";
import { saveDid } from "./didRepo";

export const DID_DRAFT_KEY = "esmeworld-what-i-did";

export interface DidDraft {
  itemId: string;
  at: Pick<DidEntry, "id" | "on" | "session">;
  text: string;
}

/** The kept draft, or null (none, unreadable, or storage blocked). */
export function readDidDraft(): DidDraft | null {
  try {
    const raw = localStorage.getItem(DID_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<DidDraft>;
    const at = d.at as Partial<DidEntry> | undefined;
    if (typeof d.itemId !== "string" || typeof d.text !== "string" || !at || typeof at.id !== "string" || typeof at.on !== "string") return null;
    return { itemId: d.itemId, at: { id: at.id, on: at.on, ...(typeof at.session === "string" ? { session: at.session } : {}) }, text: d.text };
  } catch {
    return null;
  }
}

/** Keeps the words being typed (storage blocked: they live as long as the page). */
export function keepDidDraft(d: DidDraft): void {
  try {
    localStorage.setItem(DID_DRAFT_KEY, JSON.stringify(d));
  } catch {
    // A private window or blocked storage.
  }
}

/** Forgets the draft once exactly these words are saved on that note. */
export function clearDidDraft(itemId: string, entryId: string, saved: string): void {
  const d = readDidDraft();
  if (!d || d.itemId !== itemId || d.at.id !== entryId || d.text !== saved) return;
  try {
    localStorage.removeItem(DID_DRAFT_KEY);
  } catch {
    // Blocked storage: nothing was kept.
  }
}

/** On start: a draft left behind is saved on its to-do, then forgotten. */
export async function recoverDidDraft(today: ISODate): Promise<void> {
  const d = readDidDraft();
  if (!d) return;
  await saveDid(d.itemId, d.at, { note: d.text }, today);
  clearDidDraft(d.itemId, d.at.id, d.text);
}
