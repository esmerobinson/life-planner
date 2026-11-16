import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { exportBackup, restoreBackup } from "../../data/backup";
import { db } from "../../data/db";
import { listLearned, readLearned, removeLearnedVersion, saveLearned } from "../../data/repo";
import { addDays } from "../../domain/dates";
import type { JournalRow } from "../../domain/types";
import { journalAad, sealJson, type JournalKey } from "../../journal/crypto";
import { readJournalDays } from "../../together/journalNotes";
import { emptyDb, journalDay } from "../../together/testKit";
import { confirmedDevice } from "../../test/journalKey";
import { LearnedInReadBack } from "./LearnedInReadBack";
import { LearnedToday } from "./LearnedToday";
import { TOGETHER_WORDS as W } from "./wording";

// Testing session (Life Planner - Together Round 3 Testing), 2026-11-05. Round 3 adds "Add to my
// words" and "Remove" under each earlier "what I learned" version. Remove must only ever hide the
// one version she chose, after asking; Add must never lose what's in the box. Made-up words only.
// Tests named "BUG:" fail on together-link @696dede.

beforeEach(emptyDb);

const DAY = "2026-11-04";
const YESTERDAY = "2026-11-03";
const MAC = "device-pretend-mac-01";
const PHONE = "device-pretend-phone-1";
const BOX = "Pretend Halvery Mac lesson: rest is work too.";
const PICKED = "Pretend Tormund phone lesson: name the feeling.";
const KEEP = "Pretend Ostrel phone lesson: one thing at a time.";
const OLD = "Pretend Wennick lesson from yesterday.";

let vid = 0;
/** A version row as another device seals it (the repo's own id and sealing), with a chosen `at`. */
async function versionRow(jk: JournalKey, date: string, device: string, text: string, at: number, seen?: string[]): Promise<JournalRow> {
  const id = `learned:${date}:${device}_t${(++vid).toString(36)}`;
  return { id, kind: "learned", date, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text, at, ...(seen ? { seen } : {}) }, journalAad(id))) };
}

/** The box holds the Mac's words (newest); two phone versions and yesterday's words sit apart. */
async function day() {
  const { jk } = await journalDay(DAY, {});
  const now = Date.now();
  const picked = await versionRow(jk, DAY, PHONE, PICKED, now - 60_000);
  const keep = await versionRow(jk, DAY, PHONE, KEEP, now - 50_000);
  const old = await versionRow(jk, YESTERDAY, MAC, OLD, now - 86_400_000);
  await db.journal.bulkPut([picked, keep, old]);
  const box = await saveLearned(jk, DAY, MAC, BOX);
  return { jk, picked: picked.id, keep: keep.id, old: old.id, box };
}

const allWords = async (jk: JournalKey, date = DAY) => {
  const d = await readLearned(jk, date);
  return [d.text, ...d.others.map((o) => o.text)];
};
const learnedRows = async () => (await db.journal.where("kind").equals("learned").toArray()).sort((a, b) => a.id.localeCompare(b.id));

/** The block under the box holding `text`. */
const blockOf = (text: string) => screen.getByText(text).closest(".together-learned-other") as HTMLElement;

describe("Remove", () => {
  it("removes only the version she chose: the box's words, the other phone version and yesterday's words stay; every sealed row is kept", async () => {
    const { jk } = await day();
    const before = await learnedRows();
    render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
    await screen.findByDisplayValue(BOX);
    await userEvent.click(within(await waitFor(() => blockOf(PICKED))).getByRole("button", { name: W.learnedRemove }));
    await userEvent.click(within(screen.getByRole("group", { name: W.learnedRemoveAsk })).getByRole("button", { name: W.learnedRemoveYes }));
    await waitFor(() => expect(screen.queryByText(PICKED)).toBeNull());
    expect(await allWords(jk)).toEqual([BOX, KEEP]);
    expect(await allWords(jk, YESTERDAY)).toEqual([OLD]);
    expect(screen.getByLabelText(W.learnedLabel)).toHaveValue(BOX);
    expect(screen.getByText(KEEP)).toBeInTheDocument();
    const after = await learnedRows();
    expect(after.length).toBe(before.length + 1);
    for (const r of before) expect(after.find((x) => x.id === r.id), `row ${r.id} kept, unchanged`).toEqual(r);
  });

  it("asks first; \"Keep them\" writes nothing and changes nothing on screen", async () => {
    const { jk } = await day();
    const before = await learnedRows();
    render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
    await screen.findByDisplayValue(BOX);
    await userEvent.click(within(await waitFor(() => blockOf(PICKED))).getByRole("button", { name: W.learnedRemove }));
    expect(await learnedRows(), "nothing written before she confirms").toEqual(before);
    await userEvent.click(within(screen.getByRole("group", { name: W.learnedRemoveAsk })).getByRole("button", { name: W.learnedRemoveNo }));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(await learnedRows()).toEqual(before);
    expect(screen.getByText(PICKED)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: W.learnedRemoveAsk })).toBeNull();
  });

  it("removed words never go to Together, even once she later empties the box", async () => {
    const { jk, picked } = await day();
    await removeLearnedVersion(jk, DAY, MAC, picked);
    await new Promise((r) => setTimeout(r, 3));
    // She empties the box later: the newest version is now empty.
    const s = await saveLearned(jk, DAY, MAC, "", { seen: [(await readLearned(jk, DAY)).id] });
    expect(s).toBeTruthy();
    const days = await readJournalDays(jk, addDays(DAY, 2));
    const note = days.exercise?.notes.get(DAY)?.full ?? "";
    expect(note).not.toContain(PICKED);
    // Nothing hidden behind it either: what's left is the other phone version, under the box.
    expect(await allWords(jk)).toEqual(["", KEEP]);
  });

  it("Read back afterwards shows exactly what's left, word for word", async () => {
    const { jk, picked } = await day();
    await removeLearnedVersion(jk, DAY, MAC, picked);
    const days = await listLearned(jk, addDays(DAY, 1));
    const rb = render(<LearnedInReadBack day={days.find((d) => d.date === DAY)!} />);
    expect([...rb.container.querySelectorAll(".journal-past-answer")].map((p) => p.textContent)).toEqual([BOX, KEEP]);
    expect(rb.container.textContent).not.toContain(PICKED);
  });

  it("a backup round trip (replace and merge) keeps the removal and every sealed row", async () => {
    const { jk, picked } = await day();
    await removeLearnedVersion(jk, DAY, MAC, picked);
    const before = await learnedRows();
    for (const mode of ["replace", "merge"] as const) {
      const file = JSON.parse(JSON.stringify(await exportBackup("2026-11-05")));
      expect(JSON.stringify(file)).not.toMatch(/Tormund|Halvery|Ostrel/);
      await Promise.all([db.journal.clear(), db.syncMeta.clear(), db.pending.clear(), db.quarantine.clear()]);
      await confirmedDevice(db, jk);
      await restoreBackup(file, mode);
      expect(await learnedRows(), `${mode}: rows`).toEqual(before);
      expect(await allWords(jk), `${mode}: still removed`).toEqual([BOX, KEEP]);
    }
  });

  it("BUG: the same words saved twice (say on both devices): once she removes them, they don't come straight back under the box", async () => {
    const { jk } = await journalDay(DAY, {});
    const now = Date.now();
    const a = await versionRow(jk, DAY, PHONE, PICKED, now - 60_000);
    const b = await versionRow(jk, DAY, "device-pretend-ipad-9", PICKED, now - 55_000);
    await db.journal.bulkPut([a, b]);
    await saveLearned(jk, DAY, MAC, BOX);
    render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
    await screen.findByDisplayValue(BOX);
    expect(screen.getAllByText(PICKED), "set-up: shown once").toHaveLength(1);
    await userEvent.click(within(blockOf(PICKED)).getByRole("button", { name: W.learnedRemove }));
    await userEvent.click(within(screen.getByRole("group", { name: W.learnedRemoveAsk })).getByRole("button", { name: W.learnedRemoveYes }));
    await act(() => new Promise((r) => setTimeout(r, 100)));
    expect(await allWords(jk), "the words she removed are back under the box").toEqual([BOX]);
  });
});

describe("Add to my words", () => {
  it("keeps what she has just typed in the box (not saved yet), adds the earlier words after it, and both survive a reload", async () => {
    const { jk } = await day();
    const view = render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
    const box = (await screen.findByDisplayValue(BOX)) as HTMLTextAreaElement;
    const typed = `${BOX} Pretend Faverly afterthought.`;
    fireEvent.change(box, { target: { value: typed } }); // within the autosave pause
    await userEvent.click(within(blockOf(PICKED)).getByRole("button", { name: W.learnedMerge }));
    const want = `${typed}\n\n${PICKED}`;
    await waitFor(() => expect(box).toHaveValue(want));
    await waitFor(async () => expect(await allWords(jk)).toEqual([want, KEEP]));
    view.unmount();
    render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
    await waitFor(() => expect(screen.getByLabelText(W.learnedLabel)).toHaveValue(want));
    expect(screen.getByText(KEEP)).toBeInTheDocument();
  });

  it("when the box holds the other device's words, adding keeps them, and only the two versions involved are replaced", async () => {
    const { jk } = await journalDay(DAY, {});
    const now = Date.now();
    const mine = await versionRow(jk, DAY, MAC, BOX, now - 60_000);
    const theirs = await versionRow(jk, DAY, PHONE, PICKED, now - 1000); // newest: in the box
    const other = await versionRow(jk, DAY, PHONE, KEEP, now - 70_000);
    await db.journal.bulkPut([mine, theirs, other]);
    render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
    await screen.findByDisplayValue(PICKED);
    await userEvent.click(within(blockOf(BOX)).getByRole("button", { name: W.learnedMerge }));
    await waitFor(async () => expect(await allWords(jk)).toEqual([`${PICKED}\n\n${BOX}`, KEEP]));
  });
});

// ---- two devices (each in turn in this one database, as TestingLearnedRound2 does) ---------------

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
/** Both sync: each row is only ever written by its own device, so its own copy wins. */
async function sync() {
  const all = new Map<string, JournalRow>();
  for (const dev of [MAC, PHONE]) for (const [id, r] of stores[dev] ?? new Map()) if (id.includes(`:${dev}_`) || !all.has(id)) all.set(id, r);
  for (const dev of [MAC, PHONE]) stores[dev] = new Map(all);
}

describe("on two devices", () => {
  beforeEach(() => {
    for (const k of Object.keys(stores)) delete stores[k];
  });

  it("Remove and Add on the Mac reach the phone after sync", async () => {
    const { jk, picked } = await day();
    await keep(MAC);
    await sync();
    await be(MAC);
    await removeLearnedVersion(jk, DAY, MAC, picked);
    const v = render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
    await screen.findByDisplayValue(BOX);
    await userEvent.click(within(await waitFor(() => blockOf(KEEP))).getByRole("button", { name: W.learnedMerge }));
    const want = `${BOX}\n\n${KEEP}`;
    await waitFor(async () => expect(await allWords(jk)).toEqual([want]));
    v.unmount();
    await keep(MAC);
    await sync();
    await be(PHONE);
    expect(await allWords(jk)).toEqual([want]);
  });

  it("(set-up check for the next test) a box left open goes on rewriting its own row after she clicks away and types again", async () => {
    const { jk } = await journalDay(DAY, {});
    render(<LearnedToday jk={jk} today={DAY} deviceId={PHONE} />);
    const box = await screen.findByLabelText(W.learnedLabel);
    fireEvent.change(box, { target: { value: PICKED } });
    fireEvent.blur(box);
    await waitFor(async () => expect((await readLearned(jk, DAY)).text).toBe(PICKED));
    const first = (await learnedRows()).map((r) => r.id);
    await act(() => new Promise((r) => setTimeout(r, 30)));
    fireEvent.change(box, { target: { value: `${PICKED} More.` } });
    fireEvent.blur(box);
    await waitFor(async () => expect((await readLearned(jk, DAY)).text).toBe(`${PICKED} More.`));
    expect((await learnedRows()).map((r) => r.id), "the same row, rewritten").toEqual(first);
  });

  it("BUG: the phone, offline, goes on adding to its own words while the Mac removes that version: what the phone wrote afterwards isn't lost", async () => {
    const { jk } = await journalDay(DAY, {});
    // 9:00 the phone writes (its box session's own row) and syncs.
    await be(PHONE);
    const phoneVersion = await saveLearned(jk, DAY, PHONE, PICKED);
    await keep(PHONE);
    await new Promise((r) => setTimeout(r, 3));
    // The Mac, offline since before, writes its own words (newer, never saw the phone's).
    await be(MAC);
    await saveLearned(jk, DAY, MAC, BOX);
    await keep(MAC);
    await sync(); // the Mac now has both; the phone goes offline right after sending
    stores[PHONE] = new Map([...stores[PHONE]!].filter(([id]) => !id.includes(`:${MAC}_`)));
    // The Mac: she removes the phone's version (the one she sees under her box).
    await be(MAC);
    expect(await allWords(jk), "set-up").toEqual([BOX, PICKED]);
    await removeLearnedVersion(jk, DAY, MAC, phoneVersion);
    await keep(MAC);
    // The phone, still offline, its box still open: she adds a line. Its session goes on
    // rewriting its own row (what LearnedBox does while the box holds that session's version).
    await be(PHONE);
    await new Promise((r) => setTimeout(r, 3));
    const added = `${PICKED} Pretend Quillon line, written later on the phone.`;
    await saveLearned(jk, DAY, PHONE, added, { version: phoneVersion, seen: [] });
    await keep(PHONE);
    await sync();
    for (const dev of [MAC, PHONE]) {
      await be(dev);
      expect((await allWords(jk)).join("\n"), `on ${dev}: the line written on the phone after the Mac's Remove`).toContain("Pretend Quillon line");
    }
  });
});
