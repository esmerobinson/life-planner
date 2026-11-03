// Session ticks that two devices make between syncs (fix round 1, I-4).
//
// Rows are last-write-wins, and a project's sessions live inside its row: a device's tick
// on session 2 would vanish when another device's newer row (ticking session 4) wins.
// So every local tick or untick of a session is also noted here, on this device only (in
// syncMeta, which never syncs), with the stamp of the write that made it. When a newer row
// from the server replaces a project that has such notes, they are put back onto it by
// session id and the result is written as a new local change, so it is sent and neither
// tick is lost. Nothing but `doneOn` is merged. A note is forgotten once the server has
// accepted the version that carried it (or a newer row already holds it).
//
// Limit: two devices that each log "the next session" (the main tick) without syncing in
// between tick the SAME session, so that is one tick, not two.

import { todayISO } from "../domain/dates";
import { isProject, withSessions } from "../domain/projects";
import type { Item, Session } from "../domain/types";
import type { HubDB } from "./db";

const PREFIX = "sessionTicks:";
export const ticksKey = (itemId: string) => `${PREFIX}${itemId}`;

/** Per session id: the day it was ticked (null: unticked), and the stamp of the write. */
type Ticks = Record<string, { doneOn: string | null; at: number }>;

/**
 * Notes the sessions whose tick changed between `before` and `after`. Runs inside the
 * caller's transaction, which must include `items` and `syncMeta`; `stamp` is the written
 * row's updatedAt.
 */
export async function noteSessionTicks(
  db: HubDB,
  itemId: string,
  before: Session[] | undefined,
  after: Session[],
  stamp: number,
): Promise<void> {
  const was = new Map((before ?? []).map((s) => [s.id, s.doneOn]));
  const changed = after.filter((s) => was.get(s.id) !== s.doneOn);
  if (changed.length === 0) return;
  const row = await db.syncMeta.get(ticksKey(itemId));
  const ticks: Ticks = { ...((row?.value as Ticks | undefined) ?? {}) };
  for (const s of changed) ticks[s.id] = { doneOn: s.doneOn ?? null, at: stamp };
  await db.syncMeta.put({ key: ticksKey(itemId), value: ticks });
}

/**
 * A newer row from the server is about to replace this project: the row with this device's
 * noted ticks put back on (status following), or null when there is nothing to carry (the
 * notes are then forgotten). Runs inside the sync's apply transaction.
 */
export async function carrySessionTicks(db: HubDB, incoming: Item): Promise<Item | null> {
  const row = await db.syncMeta.get(ticksKey(incoming.id));
  if (!row) return null;
  const ticks = row.value as Ticks;
  // Binned, archived (Change to → Goal archives it) or no longer a project on the other
  // device: that wins as it is, and the ticks are dropped (re-review R-1).
  if (!isProject(incoming) || (incoming.status !== "open" && incoming.status !== "done")) {
    await db.syncMeta.delete(ticksKey(incoming.id));
    return null;
  }
  let changed = false;
  const sessions = incoming.sessions!.map((s) => {
    const t = ticks[s.id];
    if (!t || (s.doneOn ?? null) === t.doneOn) return s;
    changed = true;
    if (t.doneOn !== null) return { ...s, doneOn: t.doneOn };
    const { doneOn: _d, ...rest } = s;
    return rest;
  });
  if (!changed) {
    await db.syncMeta.delete(ticksKey(incoming.id));
    return null;
  }
  return withSessions(incoming, sessions, todayISO());
}

/**
 * The engine re-stamped the item's pending change down to `stamp` (a clock that ran far
 * ahead): notes stamped later are brought down with it, so accepting that version still
 * forgets them (re-review R-2). Inside the engine's apply transaction.
 */
export async function restampTicks(db: HubDB, itemId: string, stamp: number): Promise<void> {
  const row = await db.syncMeta.get(ticksKey(itemId));
  if (!row) return;
  const ticks = Object.fromEntries(
    Object.entries(row.value as Ticks).map(([id, t]) => [id, { ...t, at: Math.min(t.at, stamp) }]),
  );
  await db.syncMeta.put({ key: ticksKey(itemId), value: ticks });
}

/** The server accepted this device's version (stamp `upTo`) of the item: notes it carried are done. */
export async function forgetAcceptedTicks(db: HubDB, itemId: string, upTo: number): Promise<void> {
  const row = await db.syncMeta.get(ticksKey(itemId));
  if (!row) return;
  const left = Object.fromEntries(Object.entries(row.value as Ticks).filter(([, t]) => t.at > upTo));
  if (Object.keys(left).length === 0) await db.syncMeta.delete(ticksKey(itemId));
  else await db.syncMeta.put({ key: ticksKey(itemId), value: left });
}
