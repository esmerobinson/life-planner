// "Choose questions": which prompts the check-in may ask, saved per device in syncMeta
// (never synced, never in a backup). Defaults to the starters.

import type { HubDB } from "../data/db";
import { PROMPT_BY_ID, STARTER_IDS } from "./prompts";

export const ACTIVE_PROMPTS_META = "journalPrompts";

export async function loadActivePrompts(db: HubDB): Promise<string[]> {
  const value = (await db.syncMeta.get(ACTIVE_PROMPTS_META))?.value;
  if (!Array.isArray(value)) return [...STARTER_IDS];
  return value.filter((id): id is string => typeof id === "string" && PROMPT_BY_ID.has(id));
}

export async function saveActivePrompts(db: HubDB, ids: readonly string[]): Promise<void> {
  await db.syncMeta.put({ key: ACTIVE_PROMPTS_META, value: [...new Set(ids)].filter((id) => PROMPT_BY_ID.has(id)) });
}
