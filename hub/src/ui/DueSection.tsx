import { liveQuery } from "dexie";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CITIES, isLine, MAX_LEAD_MINUTES, MAX_LINE_LENGTH, MAX_LINES, normalizeDuePrefs, zoneCity, type City, type DuePrefs,
} from "../reminders/duePrefs";
import { readDueSettingsView, updateDuePrefs, type DueSettingsView } from "../reminders/dueSettings";

// Reminders in Due (2026-11-16): the settings the sync Worker reads to put her reminders into
// Due, her partner's reminders app. PLACEHOLDER LOOK (magenta, system font: reminders.css
// .due-section) and PROVISIONAL WORDING: both hers to decide.

/** Every line of this section's words, in one place, so they can be reworded at once. */
export const DUE_WORDS = {
  heading: "Reminders in Due",
  intro: "Esmeworld can put your reminders into Due. They change by themselves as you tick things off.",
  stored:
    "Stored on Due's server: the reminder titles (“Plan your day”, “Review your day”, how many to-dos are left today, and the titles of to-dos and habits that have a time or Remind me), when each one goes off (meeting times too), and your motivation lines. Due can also see when a reminder is cancelled because you ticked something off. Nothing from your journal is ever sent.",
  when: "Changes reach Due after Esmeworld syncs, within about 15 minutes.",
  toggle: "Reminders in Due",
  plan: "Plan your day",
  review: "Review your day",
  countNudge: "How many to-dos are left (one reminder)",
  nudge: "Nudge if nothing's ticked off",
  lead: "Minutes before a timed to-do",
  timeZone: "Time zone",
  where: "Where you are (for sunset)",
  places: { nyc: "New York City", rio: "Rio de Janeiro", london: "London", here: "Use my location" } as Record<City | "here", string>,
  notSet: "Not set",
  noPlace: "“Before sunset” reminders need a place: choose where you are.",
  locationFailed: "Your location couldn't be read, so it wasn't changed.",
  whereNote:
    "Where you are is kept with these settings on Esmeworld's sync server (your own location is rounded to about 10 km), only to work out sunset. Due only gets the reminder's time.",
  linesHeading: "Your motivation lines",
  linesHelp: "One goes with the nudge each day, in turn. Without any, Esmeworld sends “One small thing is enough to start.”",
  newLine: "New motivation line",
  addLine: "Add line",
  saveFailed: "That change wasn't saved. Try again.",
  readFailed: "Your Due settings couldn't be read, so they can't be changed here right now.",
  waiting: "Waiting for your Due settings from your other devices. They can be changed once this device has synced.",
  deviceZone: (zone: string) => `This device is on ${zone} time. Reminders follow the time zone above.`,
} as const;

const TIME_ROWS = [
  ["plan", DUE_WORDS.plan],
  ["review", DUE_WORDS.review],
  ["countNudge", DUE_WORDS.countNudge],
  ["nudge", DUE_WORDS.nudge],
] as const;

/**
 * A short list of zones (home, and places she might be), plus whichever one is saved. A full
 * list is ~400 entries; this one is PROVISIONAL, easy to extend.
 */
export const ZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Sao_Paulo",
  "Europe/London", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney", "UTC",
];

function zones(current: string): string[] {
  return ZONES.includes(current) ? ZONES : [current, ...ZONES];
}

const CITY_IDS = Object.keys(CITIES) as City[];
/** About 10 km: plenty for sunset (a minute's difference), and no closer than that. */
const roundPlace = (v: number) => Math.round(v * 10) / 10;

/** What the "Where you are" choice shows: her choice, else her time zone's city, else nothing. */
function whereValue(p: DuePrefs): string {
  if (p.lat !== undefined && p.lon !== undefined) return p.place && (p.place === "here" || p.place in CITIES) ? p.place : "here";
  return zoneCity(p.timeZone) ?? "";
}

export function DueSection() {
  const [view, setView] = useState<DueSettingsView | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [problem, setProblem] = useState("");
  const [draft, setDraft] = useState("");
  const [lead, setLead] = useState<string | null>(null);
  const [locationFailed, setLocationFailed] = useState(false);

  // Read live: a change synced in from another device shows at once (review I5).
  useEffect(() => {
    const sub = liveQuery(readDueSettingsView).subscribe({
      next: (v) => {
        setView(v);
        setReadFailed(false);
      },
      error: () => setReadFailed(true),
    });
    return () => sub.unsubscribe();
  }, []);

  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const change = useCallback((fn: (current: DuePrefs) => Partial<DuePrefs>) => {
    queue.current = queue.current.then(() =>
      updateDuePrefs(fn).then(
        () => setProblem(""),
        () => setProblem(DUE_WORDS.saveFailed),
      ),
    );
  }, []);

  if (!view && !readFailed) return null;
  const prefs = normalizeDuePrefs(view?.row);
  // Never save defaults over settings that couldn't be read, or before they've arrived.
  const locked = readFailed || (view?.waitingForSync ?? true);
  const set = (patch: Partial<DuePrefs>) => change(() => patch);
  const addLine = () => {
    const line = draft.trim();
    if (!isLine(line)) return;
    setDraft("");
    change((cur) => (cur.lines.length < MAX_LINES ? { lines: [...cur.lines, line] } : {}));
  };
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const where = whereValue(prefs);
  const choosePlace = (choice: string) => {
    setLocationFailed(false);
    if (choice in CITIES) {
      const c = CITIES[choice as City];
      set({ place: choice, lat: c.lat, lon: c.lon });
      return;
    }
    if (choice !== "here") return;
    // Optional: only when she picks it, and only this once (never watched).
    const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    if (!geo) {
      setLocationFailed(true);
      return;
    }
    geo.getCurrentPosition(
      (pos) => set({ place: "here", lat: roundPlace(pos.coords.latitude), lon: roundPlace(pos.coords.longitude) }),
      () => setLocationFailed(true),
      { maximumAge: 24 * 3_600_000, timeout: 20_000 },
    );
  };

  return (
    <section className="due-section" aria-labelledby="due-heading">
      <h2 id="due-heading">{DUE_WORDS.heading}</h2>
      <p>{DUE_WORDS.intro}</p>
      <p role="note">{DUE_WORDS.stored}</p>
      {readFailed && <p role="alert">{DUE_WORDS.readFailed}</p>}
      {!readFailed && view?.waitingForSync && <p role="status">{DUE_WORDS.waiting}</p>}
      <fieldset disabled={locked} className="due-fieldset">
        <button type="button" aria-pressed={prefs.on} onClick={() => set({ on: !prefs.on })}>
          {`${DUE_WORDS.toggle}: ${prefs.on ? "On" : "Off"}`}
        </button>
        <div className="due-fields">
          {TIME_ROWS.map(([key, label]) => (
            <label key={key}>
              {label}{" "}
              <input
                type="time"
                required
                value={prefs[key]}
                onChange={(e) => {
                  const t = e.target.value.slice(0, 5);
                  if (/^\d{2}:\d{2}$/.test(t)) set({ [key]: t });
                }}
              />
            </label>
          ))}
          <label>
            {DUE_WORDS.lead}{" "}
            <input
              type="number"
              min={0}
              max={MAX_LEAD_MINUTES}
              step={1}
              value={lead ?? prefs.leadMinutes}
              onChange={(e) => {
                setLead(e.target.value);
                const n = Number(e.target.value);
                if (e.target.value !== "" && Number.isInteger(n) && n >= 0 && n <= MAX_LEAD_MINUTES) set({ leadMinutes: n });
              }}
              onBlur={() => setLead(null)}
            />
          </label>
          <label>
            {DUE_WORDS.timeZone}{" "}
            <select value={prefs.timeZone} onChange={(e) => set({ timeZone: e.target.value })}>
              {zones(prefs.timeZone).map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
          <p>{DUE_WORDS.deviceZone(deviceZone)}</p>
          <label>
            {DUE_WORDS.where}{" "}
            <select value={where} onChange={(e) => choosePlace(e.target.value)}>
              {where === "" && <option value="">{DUE_WORDS.notSet}</option>}
              {[...CITY_IDS, "here" as const].map((p) => (
                <option key={p} value={p}>
                  {DUE_WORDS.places[p]}
                </option>
              ))}
            </select>
          </label>
          {where === "" && <p>{DUE_WORDS.noPlace}</p>}
          {locationFailed && <p role="alert">{DUE_WORDS.locationFailed}</p>}
          <p>{DUE_WORDS.whereNote}</p>
        </div>
        <h3>{DUE_WORDS.linesHeading}</h3>
        <p>{DUE_WORDS.linesHelp}</p>
        <ul aria-label={DUE_WORDS.linesHeading}>
          {prefs.lines.map((line, i) => (
            <li key={`${i}:${line}`}>
              <span>{line}</span>{" "}
              <button
                type="button"
                aria-label={`Remove line: ${line}`}
                onClick={() => change((cur) => ({ lines: cur.lines.filter((l, j) => !(j === i && l === line)) }))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        {prefs.lines.length < MAX_LINES && (
          <div className="due-add-line">
            <input
              type="text"
              aria-label={DUE_WORDS.newLine}
              maxLength={MAX_LINE_LENGTH}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                addLine();
              }}
            />{" "}
            <button type="button" disabled={!draft.trim()} onClick={addLine}>
              {DUE_WORDS.addLine}
            </button>
          </div>
        )}
      </fieldset>
      <p>{DUE_WORDS.when}</p>
      {problem && <p role="alert">{problem}</p>}
    </section>
  );
}
