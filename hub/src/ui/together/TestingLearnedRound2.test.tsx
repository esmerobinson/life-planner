import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { db } from "../../data/db";
import { exportBackup, restoreBackup } from "../../data/backup";
import { listLearned, readLearned } from "../../data/repo";
import { addDays } from "../../domain/dates";
import type { JournalRow } from "../../domain/types";
import type { JournalKey } from "../../journal/crypto";
import { readJournalDays } from "../../together/journalNotes";
import { confirmedDevice } from "../../test/journalKey";
import { emptyDb, journalDay } from "../../together/testKit";
import { LearnedInReadBack } from "./LearnedInReadBack";
import { LearnedToday } from "./LearnedToday";
import { TOGETHER_WORDS as W } from "./wording";

// Testing session (Together link, round-2 recheck), 2026-11-05. "What I learned today" is now one
// row per saved version (bug #41). Two devices, each offline, add to the box again and again; then
// sync; then one clears the box. Every word she wrote and didn't remove herself must still be in
// the box or under it, in Read back, and through a backup. Each device is played in turn in this
// one test database: its own rows only (offline), then both devices' rows (sync). Made-up words.

beforeEach(emptyDb);

const DAY = "2026-11-04";
const MAC = "device-pretend-mac-01";
const PHONE = "device-pretend-phone-1";

/** Each device's own copy of the day's learned rows (what it has offline). */
const stores: Record<string, Map<string, JournalRow>> = {};

async function be(device: string) {
  await db.journal.where("kind").equals("learned").delete();
  await db.journal.bulkPut([...(stores[device] ?? new Map()).values()]);
}

async function keep(device: string) {
  const m = new Map<string, JournalRow>();
  for (const r of await db.journal.where("kind").equals("learned").toArray()) m.set(r.id, r);
  stores[device] = m;
}

/** Both devices sync: each gets the other's rows (a row is only ever written by its own device). */
async function sync() {
  const all = new Map<string, JournalRow>();
  for (const dev of [MAC, PHONE]) for (const [id, r] of stores[dev] ?? new Map()) if (id.includes(`:${dev}_`) || !all.has(id)) all.set(id, r);
  for (const dev of [MAC, PHONE]) stores[dev] = new Map(all);
}

/** On `device`: open the exercise tab, the box shows what it shows, she does `edit` and clicks away. */
async function onDevice(jk: JournalKey, device: string, edit: (shown: string) => string): Promise<string> {
  await be(device);
  const view = render(<LearnedToday jk={jk} today={DAY} deviceId={device} />);
  const box = (await screen.findByLabelText(W.learnedLabel)) as HTMLTextAreaElement;
  await act(() => new Promise((r) => setTimeout(r, 30))); // the box has read the day
  const shown = box.value;
  const next = edit(shown);
  fireEvent.change(box, { target: { value: next } });
  fireEvent.blur(box);
  await waitFor(async () => expect((await readLearned(jk, DAY)).text).toBe(next));
  view.unmount();
  await keep(device);
  await new Promise((r) => setTimeout(r, 3)); // the next save is a later millisecond
  return shown;
}

const wordsOn = async (jk: JournalKey) => {
  const d = await readLearned(jk, DAY);
  return [d.text, ...d.others.map((o) => o.text)].join("\n");
};

it("two devices each add to the box three times offline, then sync: every word is on both devices, in Read back, and through a backup", async () => {
  const { jk } = await journalDay(DAY, { exercise: true });
  for (const k of Object.keys(stores)) delete stores[k];
  const added: string[] = [];
  const add = (w: string) => (shown: string) => (added.push(w), `${shown}${shown ? " " : ""}${w}`);

  await onDevice(jk, MAC, add("Pretend Arlowen first Mac line."));
  await sync();
  // Both go offline. Each adds three times, in turn, never seeing the other.
  for (const n of [1, 2, 3]) {
    await onDevice(jk, PHONE, add(`Pretend Brisket phone line ${n}.`));
    await onDevice(jk, MAC, add(`Pretend Cindral Mac line ${n}.`));
  }
  await sync();

  for (const dev of [MAC, PHONE]) {
    await be(dev);
    const words = await wordsOn(jk);
    for (const w of added) expect(words, `on ${dev}: "${w}" is gone`).toContain(w);
    // The box and what's under it, on screen.
    const view = render(<LearnedToday jk={jk} today={DAY} deviceId={dev} />);
    await screen.findByLabelText(W.learnedLabel);
    await act(() => new Promise((r) => setTimeout(r, 30)));
    const screenText = [document.body.textContent ?? "", (screen.getByLabelText(W.learnedLabel) as HTMLTextAreaElement).value].join("\n");
    for (const w of added) expect(screenText, `on ${dev}'s screen: "${w}" isn't shown`).toContain(w);
    view.unmount();

    // Read back (the day's exercise entry).
    const days = await listLearned(jk, addDays(DAY, 1));
    const rb = render(<LearnedInReadBack day={days.find((d) => d.date === DAY)!} />);
    for (const w of added) expect(rb.container.textContent, `Read back on ${dev}: "${w}"`).toContain(w);
    rb.unmount();
  }

  // Backup of the Mac (every version), restored into an empty hub: the same words.
  await be(MAC);
  const before = (await db.journal.where("kind").equals("learned").toArray()).sort((a, b) => a.id.localeCompare(b.id));
  expect(before.length, "set-up: one row per saved version").toBeGreaterThanOrEqual(7);
  for (const mode of ["replace", "merge"] as const) {
    const file = JSON.parse(JSON.stringify(await exportBackup("2026-11-05")));
    expect(JSON.stringify(file)).not.toMatch(/Arlowen|Brisket|Cindral/);
    await Promise.all([db.journal.clear(), db.syncMeta.clear(), db.pending.clear(), db.quarantine.clear()]);
    await confirmedDevice(db, jk);
    await restoreBackup(file, mode);
    const after = (await db.journal.where("kind").equals("learned").toArray()).sort((a, b) => a.id.localeCompare(b.id));
    expect(after, `${mode}: rows`).toEqual(before);
    const words = await wordsOn(jk);
    for (const w of added) expect(words, `${mode}: "${w}"`).toContain(w);
  }
});

it("cleared on one device: only what that box held goes; words written on the other device it never saw stay, and Together gets no cleared words", async () => {
  const { jk } = await journalDay(DAY, { exercise: true });
  for (const k of Object.keys(stores)) delete stores[k];
  await onDevice(jk, MAC, () => "Pretend Dunmire Mac line.");
  await sync();
  // Offline: the phone adds; the Mac clears its box (which holds only the Mac's words).
  await onDevice(jk, PHONE, (s) => `${s} Pretend Eskeld phone line.`);
  const macSaw = await onDevice(jk, MAC, () => "");
  expect(macSaw).toBe("Pretend Dunmire Mac line.");
  await sync();
  for (const dev of [MAC, PHONE]) {
    await be(dev);
    expect(await wordsOn(jk), `on ${dev}: the phone's words she never saw on the Mac`).toContain("Pretend Eskeld phone line.");
  }
  // What Together would get for that day (the day's newest version only, and none once cleared).
  await be(MAC);
  const days = await readJournalDays(jk, DAY, addDays(DAY, 2));
  const note = days.exercise?.notes.get(DAY)?.full ?? "";
  expect(note).not.toContain("Pretend Dunmire Mac line.");
});
