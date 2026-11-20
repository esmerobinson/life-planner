// Sunset, for "Before sunset" reminders (Esme, 20 Nov 2026: Calisthenics 90 minutes before
// sunset). NOAA's solar calculator (the Meeus formulas in NOAA's "General Solar Position"
// spreadsheet), worked out twice: once near the day's sunset, then again at the time found.
// Accurate to about a minute for the latitudes people live at; tested against known sunsets
// (sun.test.ts). Pure arithmetic: a few microseconds per call.
//
// The place: her own latitude and longitude from the Due settings row (prefs.ts lat/lon, set
// on the Reminders page: one of three cities or "Use my location"), else a city from her time
// zone (New York, Rio de Janeiro, London), else none: no sunset reminder can be worked out.

export interface Place {
  lat: number;
  lon: number;
}

/** The cities the Reminders page offers (the same values: hub/src/reminders/duePrefs.ts). */
export const CITIES = {
  nyc: { lat: 40.7128, lon: -74.006 },
  rio: { lat: -22.9068, lon: -43.1729 },
  london: { lat: 51.5074, lon: -0.1278 },
} as const satisfies Record<string, Place>;

/** Her time zone's city, when she hasn't said where she is. */
const ZONE_CITY: Record<string, Place> = {
  "America/New_York": CITIES.nyc,
  "America/Sao_Paulo": CITIES.rio,
  "Europe/London": CITIES.london,
};

export const isLat = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= -90 && v <= 90;
export const isLon = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= -180 && v <= 180;

/** Where her sunset is worked out: her own place (both lat and lon), else her zone's city, else null. */
export function placeFor(p: { timeZone: string; lat?: number; lon?: number }): Place | null {
  if (isLat(p.lat) && isLon(p.lon)) return { lat: p.lat, lon: p.lon };
  const city = ZONE_CITY[p.timeZone];
  return city ? { lat: city.lat, lon: city.lon } : null;
}

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
/** The Julian day of the Unix epoch. */
const JD_EPOCH = 2440587.5;
/** The sun's centre 0.833° below the horizon: refraction and the sun's own radius. */
const COS_ZENITH = Math.cos(90.833 * RAD);

/** The equation of time (minutes) and the sun's declination (radians) at Julian day `jd`. */
function sunAt(jd: number): { eqTime: number; decl: number } {
  const t = (jd - 2451545) / 36525;
  const l0 = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const mr = m * RAD;
  const c =
    Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * mr) * (0.019993 - 0.000101 * t) + Math.sin(3 * mr) * 0.000289;
  const omega = (125.04 - 1934.136 * t) * RAD;
  const lambda = (l0 + c - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * RAD;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const y = Math.tan(eps / 2) ** 2;
  const l = l0 * RAD;
  const eq =
    y * Math.sin(2 * l) - 2 * e * Math.sin(mr) + 4 * e * y * Math.sin(mr) * Math.cos(2 * l) - 0.5 * y * y * Math.sin(4 * l) -
    1.25 * e * e * Math.sin(2 * mr);
  return { eqTime: (4 * eq) / RAD, decl };
}

/**
 * The instant (epoch ms) the sun sets on calendar date `date` ("YYYY-MM-DD") at a place
 * (latitude north positive, longitude east positive), or null when it doesn't set or rise
 * that day (polar night, midnight sun).
 */
export function sunsetUtc(date: string, lat: number, lon: number): number | null {
  const midnight = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  const jd0 = midnight / DAY_MS + JD_EPOCH;
  const phi = lat * RAD;
  // Minutes after that date's UTC midnight: first guess 18:00 local solar time.
  let minutes = 720 - 4 * lon + 360;
  for (let pass = 0; pass < 2; pass++) {
    const { eqTime, decl } = sunAt(jd0 + minutes / 1440);
    const cosHa = COS_ZENITH / (Math.cos(phi) * Math.cos(decl)) - Math.tan(phi) * Math.tan(decl);
    if (!(cosHa >= -1 && cosHa <= 1)) return null;
    minutes = 720 - 4 * lon - eqTime + (4 * Math.acos(cosHa)) / RAD;
  }
  return Math.round(midnight + minutes * 60_000);
}
