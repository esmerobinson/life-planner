import { liveQuery } from "dexie";
import { useEffect, useMemo, useState } from "react";
import { db } from "../data/db";
import { frozenFill, TODAY_FILL_PREFIX, type TodayFill } from "../domain/todayFill";
import type { ISODate } from "../domain/types";

/**
 * Today's kept picks (domain/todayFill.ts), from every device's synced row, live: a row that
 * syncs in from the other device counts at once. `loaded` once the rows have been read (until
 * then nothing should be recorded); a failed read counts as no rows.
 */
export function useTodayFill(today: ISODate): { loaded: boolean; frozen: TodayFill | undefined } {
  const [rows, setRows] = useState<unknown[] | null>(null);
  useEffect(() => {
    const sub = liveQuery(() => db.prefs.where("id").startsWith(TODAY_FILL_PREFIX).toArray()).subscribe({
      next: setRows,
      error: () => setRows([]),
    });
    return () => sub.unsubscribe();
  }, []);
  const frozen = useMemo(() => (rows ? frozenFill(rows, today) : undefined), [rows, today]);
  return { loaded: rows !== null, frozen };
}
