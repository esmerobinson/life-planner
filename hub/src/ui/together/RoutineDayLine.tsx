import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { db } from "../../data/db";
import { readSharePrivate, type DayLogFields, type FormDay } from "../../data/repo";
import type { ISODate } from "../../domain/types";
import type { JournalKey } from "../../journal/crypto";
import { ANSWERS_DELAY_MS } from "../../together/sender";
import { isFinal, ROUTINE_KEYS, routineDayHold, SEND_ROUTINE_CHALLENGES } from "../../together/routineChallenges";
import { readSent, TOGETHER_META } from "../../together/store";
import { TOGETHER_WORDS as W } from "./wording";
import "./together.css";

type Line = keyof typeof W.routineDay;

/**
 * PLACEHOLDER (review I4, I5): under a day's log, whether and when that day goes to Together, and
 * why not ("choose one version", "press Done", private…). Only while the daily log's challenges are
 * switched on and this device is signed in to Together; never otherwise.
 */
export function RoutineDayLine({ jk, date, day }: { jk: JournalKey; date: ISODate; day: FormDay<DayLogFields> }) {
  const [line, setLine] = useState<Line | null>(null);
  useEffect(() => {
    if (!SEND_ROUTINE_CHALLENGES.on) return;
    const sub = liveQuery(async (): Promise<Line | null> => {
      if (!(await db.syncMeta.get(TOGETHER_META))) return null;
      if (day.id === "" && day.others.length === 0) return null; // nothing logged yet
      const sent = (await readSent(db))?.routine ?? {};
      if (ROUTINE_KEYS.some((k) => ["sent", "hand"].includes(sent[`${k}:${date}`] ?? ""))) return "sent";
      return routineDayHold(day, await readSharePrivate(jk, date), isFinal(date, Date.now(), ANSWERS_DELAY_MS)) ?? "next";
    }).subscribe({ next: setLine, error: () => setLine(null) });
    return () => sub.unsubscribe();
  }, [jk, date, day]);
  if (!line) return null;
  return <p className="together-warning">{W.routineDay[line]}</p>;
}
