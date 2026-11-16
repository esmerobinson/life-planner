// Esme's Rio: day, rain and night follow Rio's real weather and clock (rio-design.md, "Weather and
// night"). The weather comes from Open-Meteo, a free service with no key. The request carries
// only Rio's fixed coordinates: nothing about Esme leaves the device. If the service is down or
// she is offline, the look comes from Rio's clock (night after dark, never rain).

import { useEffect, useState } from "react";
import type { Look } from "./assets";

export const RIO = { latitude: -22.98, longitude: -43.2, timeZone: "America/Sao_Paulo" } as const;

const HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: RIO.timeZone, hour: "numeric", hourCycle: "h23" });

/** The hour (0–23) in Rio. */
export const rioHour = (now: Date): number => Number(HOUR.formatToParts(now).find((p) => p.type === "hour")!.value) % 24;

/** Night from 18:00 until 06:00 Rio time. */
export const clockLook = (now: Date): "day" | "night" => {
  const h = rioHour(now);
  return h >= 18 || h < 6 ? "night" : "day";
};

/** WMO weather codes that mean rain: drizzle, rain, freezing rain, showers, thunderstorms. */
export const RAIN_CODES: ReadonlySet<number> = new Set([
  ...range(51, 67), ...range(80, 82), ...range(95, 99),
]);
function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

export type Weather = { isDay: boolean; code: number };

export function lookFrom(w: Weather | null, now: Date): Look {
  const night = w ? !w.isDay : clockLook(now) === "night";
  if (night) return "night";
  return w && RAIN_CODES.has(w.code) ? "rain" : "day";
}

export const WEATHER_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${RIO.latitude}&longitude=${RIO.longitude}` +
  `&current=weather_code,is_day&timezone=${encodeURIComponent(RIO.timeZone)}`;
const TIMEOUT_MS = 5000;

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Rio's current weather, or null on any failure (offline, slow, an answer it can't read). */
export async function fetchRioWeather(fetchFn: FetchFn = (u, i) => fetch(u, i)): Promise<Weather | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(WEATHER_URL, { signal: ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) return null;
    const j = (await res.json()) as { current?: { weather_code?: unknown; is_day?: unknown } };
    const code = j.current?.weather_code;
    const isDay = j.current?.is_day;
    if (typeof code !== "number" || (isDay !== 0 && isDay !== 1)) return null;
    return { isDay: isDay === 1, code };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const CACHE_KEY = "rio-weather";
const KEEP_MS = 30 * 60_000;

function readCache(now: number): Weather | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as { at: number; w: Weather };
    if (typeof c.at !== "number" || now - c.at > KEEP_MS || now < c.at) return null;
    if (typeof c.w?.code !== "number" || typeof c.w?.isDay !== "boolean") return null;
    return c.w;
  } catch {
    return null;
  }
}
function writeCache(w: Weather, now: number): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, w }));
  } catch {
    // storage blocked: the next open asks again
  }
}

/**
 * The look to show: the weather (fetched on mount and every 30 minutes, kept for 30 minutes in
 * this tab), with Rio's clock as the fallback, re-read every minute.
 */
export function useRioLook(): Look {
  const [weather, setWeather] = useState<Weather | null>(() => readCache(Date.now()));
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let live = true;
    const ask = async () => {
      const cached = readCache(Date.now());
      if (cached) {
        if (live) setWeather(cached);
        return;
      }
      const w = await fetchRioWeather();
      if (!live) return;
      if (w) writeCache(w, Date.now());
      setWeather(w);
    };
    void ask();
    const t = setInterval(() => void ask(), KEEP_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  return lookFrom(weather, now);
}
