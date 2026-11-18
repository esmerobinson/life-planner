import { liveQuery } from "dexie";
import { useEffect, useMemo, useState } from "react";
import { db } from "../data/db";
import { OWN_FILL_META, daySeenAt, syncGate, type GateMode } from "../data/todayFillRepo";
import { effectiveFill, todayFillRowId, validOwnFill, type TodayFill } from "../domain/todayFill";
import type { ISODate } from "../domain/types";

interface Read {
  shared: unknown;
  own: unknown;
  token: boolean;
  firstPull: boolean;
  lastFullSyncAt: number | undefined;
}

const online = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/**
 * Today's kept picks (domain/todayFill.ts), live: the day's shared row as it syncs in, or this
 * device's own copy once she has used Today here (or while it was picked offline). `loaded` once
 * read (until then nothing should be judged or recorded; a failed read counts as none). `mode`:
 * how the picks may be kept now (data/todayFillRepo.ts syncGate: "publish", "local" when offline
 * before the day's full sync, or "wait"). `unpublished`: this device holds picks kept offline,
 * still to publish (or give up for another device's row) once the day's full sync is in.
 */
export function useTodayFill(today: ISODate): {
  loaded: boolean;
  frozen: TodayFill | undefined;
  mode: GateMode;
  unpublished: boolean;
} {
  const [read, setRead] = useState<Read | null>(null);
  const [isOnline, setOnline] = useState(online);
  useEffect(() => {
    setRead(null);
    const sub = liveQuery(async (): Promise<Read> => {
      const [shared, own, token, firstPull, last] = await Promise.all([
        db.prefs.get(todayFillRowId(today)),
        db.syncMeta.get(OWN_FILL_META),
        db.syncMeta.get("token"),
        db.syncMeta.get("firstPullDone"),
        db.syncMeta.get("lastFullSyncAt"),
      ]);
      return {
        shared,
        own: own?.value,
        token: Boolean(token?.value),
        firstPull: firstPull?.value === true,
        lastFullSyncAt: typeof last?.value === "number" ? last.value : undefined,
      };
    }).subscribe({
      next: setRead,
      error: () => setRead({ shared: undefined, own: undefined, token: false, firstPull: false, lastFullSyncAt: undefined }),
    });
    return () => sub.unsubscribe();
  }, [today]);
  useEffect(() => {
    const on = () => setOnline(online());
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  const daySeen = useMemo(() => daySeenAt(today), [today]);
  const frozen = useMemo(() => (read ? effectiveFill(read.shared, read.own, today) : undefined), [read, today]);
  const mode: GateMode = read === null ? "wait" : syncGate({ ...read, online: isOnline, daySeen });
  const unpublished = read !== null && validOwnFill(read.own) && read.own.date === today && read.own.unpublished === true;
  return { loaded: read !== null, frozen, mode, unpublished };
}
