// Esme's Rio: the map's holiday takeovers (map.json `events`). Carnaval dresses the whole city
// from 1 to 15 February; Réveillon all of 31 December (map.json: "the day look all of 31
// December, the night look from dusk until the morning of 1 January"), its night running until
// 06:00 on 1 January. Every place wears it, open or not (Esme, 2026-11-15). Dates are read in
// Rio's time zone, so a device anywhere agrees.

import { useEffect, useState } from "react";
import { RIO_MAP, type RioEvent } from "./assets";
import { RIO } from "./look";

const FORMAT = new Intl.DateTimeFormat("en-GB", { timeZone: RIO.timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });

/** The month-day ("MM-DD") and hour (0–23) in Rio. */
export function rioDate(now: Date): { md: string; hour: number } {
  const parts = Object.fromEntries(FORMAT.formatToParts(now).map((p) => [p.type, p.value]));
  return { md: `${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

/** "01-01 06:00 Rio time" → the day and hour a takeover's night runs until. */
function runsUntil(e: RioEvent): { md: string; hour: number } | null {
  const m = /^(\d\d-\d\d) (\d\d):\d\d/.exec(e.dates.night_runs_until ?? "");
  return m ? { md: m[1]!, hour: Number(m[2]) } : null;
}

/** The takeover the map wears at this moment, if any. */
export function activeEvent(now: Date, events: readonly RioEvent[] = RIO_MAP.events): RioEvent | null {
  const { md, hour } = rioDate(now);
  for (const e of events) {
    if (md >= e.dates.from && md <= e.dates.to) return e;
    const until = runsUntil(e);
    if (until && md === until.md && hour < until.hour) return e;
  }
  return null;
}

/**
 * Which of a takeover's layers to draw: the map's look (rain shows the day layer); while a
 * takeover's night runs past midnight (Réveillon, until 06:00 on 1 January) always the night one.
 */
export function eventLook(e: RioEvent, now: Date, look: "day" | "rain" | "night"): "day" | "night" {
  const until = runsUntil(e);
  const { md, hour } = rioDate(now);
  if (until && md === until.md && hour < until.hour) return "night";
  return look === "night" ? "night" : "day";
}

/** The time, re-read every minute (or the fixed one given, for tests and previews). */
export function useNow(fixed?: Date): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (fixed) return;
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, [fixed]);
  return fixed ?? now;
}
