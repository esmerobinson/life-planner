import { useCallback, useEffect, useRef, useState } from "react";
import { askNotifyPermission, hasNativeReminders, notifyPermission, type NotifyPermission } from "../reminders/bridge";
import {
  DEFAULT_REMINDER_SETTINGS, type MonthlyWhen, type ReminderKind, type ReminderSettings, type ReviewWeekday,
} from "../reminders/schedule";
import { rescheduleReminders } from "../reminders/scheduler";
import { loadReminderSettings, saveReminderSettings } from "../reminders/settings";
import { usePhone } from "./usePhone";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The rows, in the mockup's (4A) order, with a sample of what each says (the mockup's draft wording). */
function rows(lastMonth: string): { kind: ReminderKind; name: string; sample: string }[] {
  return [
    { kind: "morning", name: "Morning pages", sample: "Morning pages: Three pages, before anything else." },
    { kind: "checkin", name: "Daily check-in", sample: "Daily check-in: A few questions to close the day." },
    { kind: "todos", name: "To-dos and deadlines", sample: "3 to-dos today: Finish the draft, Book the dentist and 1 more" },
    { kind: "session", name: "Project session today", sample: "Your project: Session 3 of 4 is planned for today." },
    { kind: "weekly", name: "Weekly review", sample: "Weekly review: Your week is ready to look back on." },
    { kind: "monthly", name: "Monthly review", sample: `${lastMonth} review: Your month is ready to look back on.` },
  ];
}

const WEEKDAY_LABEL: Record<ReviewWeekday, string> = { sun: "Sunday", sat: "Saturday", mon: "Monday" };
const MONTHLY_LABEL: Record<MonthlyWhen, string> = { first: "On the 1st", "last-sunday": "Last Sunday" };

/** Where this page is showing: the Mac app (notifies), the phone, or a desktop browser (neither yet). */
type Place = "mac" | "phone" | "browser";

function usePlace(): Place {
  const phone = usePhone();
  if (hasNativeReminders()) return "mac";
  const ios = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
  return phone || ios ? "phone" : "browser";
}

/**
 * Reminders (2026-11-04, Esme's pick 4A "a simple list"): one row per reminder with its name,
 * the words it says, its time and an On / Off pill. Settings are this device's own. In the Mac
 * app, the Mac asks once for permission (when this page opens, or a reminder is turned on).
 */
export function RemindersPage() {
  const place = usePlace();
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [permission, setPermission] = useState<NotifyPermission>("unknown");
  const [problem, setProblem] = useState("");
  const asked = useRef(false);

  const ask = useCallback(async () => {
    if (place !== "mac") return;
    let p = await notifyPermission();
    if (p === "not-determined" && !asked.current) {
      asked.current = true;
      p = await askNotifyPermission();
      // Just allowed: the reminders that were waiting for it go to the Mac now.
      if (p === "authorized") void rescheduleReminders();
    }
    setPermission(p);
  }, [place]);

  useEffect(() => {
    let live = true;
    loadReminderSettings().then(
      (s) => {
        if (!live) return;
        setSettings(s);
        if (Object.values(s).some((r) => r.on)) void ask();
        else if (place === "mac") void notifyPermission().then((p) => live && setPermission(p));
      },
      () => live && (setSettings(DEFAULT_REMINDER_SETTINGS), setProblem("Your reminder settings couldn't be read.")),
    );
    return () => {
      live = false;
    };
  }, [ask, place]);

  const change = useCallback(
    async (next: ReminderSettings, turnedOn = false) => {
      setSettings(next);
      try {
        await saveReminderSettings(next);
        setProblem("");
      } catch {
        setProblem("That change wasn't saved. Try again.");
      }
      if (turnedOn) await ask();
    },
    [ask],
  );

  const now = new Date();
  const lastMonth = MONTHS[(now.getMonth() + 11) % 12];
  const where = place === "mac" ? "on this Mac" : "";

  return (
    <section className="reminders-page">
      <h1>Reminders</h1>
      <p className="rem-intro">
        Esmeworld pops up a notification{where ? ` ${where}` : ""} at these times. Nothing pops up if you've already done it today.
      </p>
      {place === "phone" && (
        <p className="rem-note" role="note">
          Reminders on the phone come with the iPhone app (or a later push server). What you set here is kept on this phone for then.
        </p>
      )}
      {place === "browser" && (
        <p className="rem-note" role="note">
          Reminders pop up from the Esmeworld Mac app. A browser tab can't show them.
        </p>
      )}
      {settings && (
        <ul className="rem-list">
          {rows(lastMonth).map(({ kind, name, sample }) => {
            const r = settings[kind];
            const set = (patch: Partial<ReminderSettings[typeof kind]>) =>
              void change({ ...settings, [kind]: { ...r, ...patch } } as ReminderSettings, patch.on === true);
            return (
              <li key={kind} className={r.on ? "rem-row" : "rem-row off"}>
                <div>
                  <div className="rem-name">{name}</div>
                  <div className="strip-meta">“{sample}”</div>
                </div>
                <div className="rem-when">
                  {kind === "weekly" && (
                    <select
                      aria-label={`${name} day`}
                      value={settings.weekly.day}
                      onChange={(e) => set({ day: e.target.value as ReviewWeekday })}
                    >
                      {(Object.keys(WEEKDAY_LABEL) as ReviewWeekday[]).map((d) => (
                        <option key={d} value={d}>{WEEKDAY_LABEL[d]}</option>
                      ))}
                    </select>
                  )}
                  {kind === "monthly" && (
                    <select
                      aria-label={`${name} day`}
                      value={settings.monthly.when}
                      onChange={(e) => set({ when: e.target.value as MonthlyWhen })}
                    >
                      {(Object.keys(MONTHLY_LABEL) as MonthlyWhen[]).map((w) => (
                        <option key={w} value={w}>{MONTHLY_LABEL[w]}</option>
                      ))}
                    </select>
                  )}
                  <input
                    type="time"
                    aria-label={`${name} time`}
                    value={r.time}
                    required
                    onChange={(e) => {
                      if (/^\d{2}:\d{2}$/.test(e.target.value)) set({ time: e.target.value });
                    }}
                  />
                </div>
                <button type="button" aria-pressed={r.on} aria-label={`${name}: ${r.on ? "On" : "Off"}`} onClick={() => set({ on: !r.on })}>
                  {r.on ? "On" : "Off"}
                </button>
                {kind === "todos" && (
                  <label className="form-check rem-extra">
                    <input
                      type="checkbox"
                      checked={settings.todos.dayBefore}
                      onChange={(e) => set({ dayBefore: e.target.checked })}
                    />{" "}
                    Deadlines: also the day before
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {problem && (
        <p className="rem-note" role="alert">
          {problem}
        </p>
      )}
      {place === "mac" && permission === "denied" ? (
        <p className="rem-note" role="status">
          Notifications are turned off for Esmeworld. Turn them on in System Settings, Notifications, Esmeworld.
        </p>
      ) : place === "mac" && permission === "not-determined" && asked.current ? (
        // Asked, yet no answer: the Mac didn't put up its question (e.g. it won't for this build).
        <p className="rem-note" role="status">
          The Mac didn't ask whether Esmeworld may send notifications, so reminders can't pop up yet.
        </p>
      ) : place === "mac" ? (
        <p className="rem-foot">The first time you turn one on, the Mac asks once whether Esmeworld may send notifications.</p>
      ) : null}
    </section>
  );
}
