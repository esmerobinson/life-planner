import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { exportBackup, restoreBackup } from "../../data/backup";
import { db } from "../../data/db";
import { listLearned, readLearned, removeLearnedVersion, saveLearned } from "../../data/repo";
import { addDays } from "../../domain/dates";
import type { JournalRow } from "../../domain/types";
import { journalAad, sealJson, type JournalKey } from "../../journal/crypto";
import { getDeviceId } from "../../sync/engine";
import { readJournalDays } from "../../together/journalNotes";
import { emptyDb, journalDay } from "../../together/testKit";
import { confirmedDevice } from "../../test/journalKey";
import { LearnedInReadBack } from "./LearnedInReadBack";
import { LearnedToday } from "./LearnedToday";
import { TOGETHER_WORDS as W } from "./wording";

// Testing session (Life Planner - Together-link Testing Round 5), 2026-11-06. Round 4's #55
// (Remove / Add / the box act on every version with the same words) and #56 (a version is
// hidden only as she saw it: `<id>@<stamp>`), and round 5's restore-safe learned writes (the
// current device id after a Replace). Made-up words only. Tests named "BUG:" fail on
// together-link @4df1240.

beforeEach(emptyDb);

const DAY = "2026-11-04";
const MAC = "device-pretend-mac-01";
const PHONE = "device-pretend-phone-1";
const IPAD = "device-pretend-ipad-9";
const BOX = "Pretend Arnsby Mac lesson: slow is fine.";
const PICKED = "Pretend Bellcote phone lesson: breathe out longer.";
const KEEP = "Pretend Caddow phone lesson: one step.";

let vid = 0;
/** A version row as another device seals it (the repo's own id shape), with a chosen `at`, or a given id. */
async function versionRow(jk: JournalKey, device: string, text: string, at: number, opts: { seen?: string[]; id?: string } = {}): Promise<JournalRow> {
  const id = opts.id ?? `learned:${DAY}:${device}_r5${(++vid).toString(36)}`;
  return { id, kind: "learned", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text, at, ...(opts.seen ? { seen: opts.seen } : {}) }, journalAad(id))) };
}

const allWords = async (jk: JournalKey) => {
  const d = await readLearned(jk, DAY);
  return [d.text, ...d.others.map((o) => o.text)];
};
const blockOf = (text: string) => screen.getByText(text).closest(".together-learned-other") as HTMLElement;
const pause = (ms = 60) => act(() => new Promise((r) => setTimeout(r, ms)));

async function removeInUi(text: string) {
  await userEvent.click(within(await waitFor(() => blockOf(text))).getByRole("button", { name: W.learnedRemove }));
  await userEvent.click(within(screen.getByRole("group", { name: W.learnedRemoveAsk })).getByRole("button", { name: W.learnedRemoveYes }));
}

// ---- #56: hidden as she saw it -------------------------------------------------------------------

describe("#56: a removed version stays hidden as she saw it", () => {
  it("an OLDER copy of the removed row arriving late (sync) never un-hides it", async () => {
    const { jk } = await journalDay(DAY, {});
    const now = Date.now();
    const picked = await versionRow(jk, PHONE, PICKED, now - 60_000);
    await db.journal.put(picked);
    await saveLearned(jk, DAY, MAC, BOX);
    await removeLearnedVersion(jk, DAY, MAC, picked.id);
    expect(await allWords(jk)).toEqual([BOX]);
    // An older copy of that same row (the phone's earlier save of it) arrives late.
    await db.journal.put(await versionRow(jk, PHONE, "Pretend Bellcote, an earlier save", now - 90_000, { id: picked.id }));
    expect(await allWords(jk)).toEqual([BOX]);
  });

  it("a LATER write to the removed row (the phone's box going on) shows again; Remove never hides different words", async () => {
    const { jk } = await journalDay(DAY, {});
    const now = Date.now();
    const picked = await versionRow(jk, PHONE, PICKED, now - 60_000);
    const keep = await versionRow(jk, IPAD, KEEP, now - 50_000);
    await db.journal.bulkPut([picked, keep]);
    await saveLearned(jk, DAY, MAC, BOX);
    await removeLearnedVersion(jk, DAY, MAC, picked.id);
    expect(await allWords(jk), "different words on another device stay").toEqual([BOX, KEEP]);
    await db.journal.put(await versionRow(jk, PHONE, `${PICKED} Pretend Dunsop line added later.`, now - 1000, { id: picked.id }));
    expect((await allWords(jk)).join("\n")).toContain("Pretend Dunsop line added later.");
  });

  it("(documents) a DIFFERENT version with the same words, written before the Remove but arriving after it, shows (she never saw it)", async () => {
    const { jk } = await journalDay(DAY, {});
    const now = Date.now();
    const picked = await versionRow(jk, PHONE, PICKED, now - 60_000);
    await db.journal.put(picked);
    await saveLearned(jk, DAY, MAC, BOX);
    await removeLearnedVersion(jk, DAY, MAC, picked.id);
    await db.journal.put(await versionRow(jk, IPAD, PICKED, now - 70_000));
    expect(await allWords(jk)).toEqual([BOX, PICKED]);
  });
});

// ---- #55: same words, one entry ------------------------------------------------------------------

describe("#55: Remove, Add and the box act on every version with the same words", () => {
  async function dupes() {
    const { jk } = await journalDay(DAY, {});
    const now = Date.now();
    await db.journal.bulkPut([
      await versionRow(jk, PHONE, PICKED, now - 60_000),
      await versionRow(jk, IPAD, PICKED, now - 55_000),
      await versionRow(jk, IPAD, KEEP, now - 50_000),
    ]);
    await saveLearned(jk, DAY, MAC, BOX);
    return { jk };
  }

  it("Remove on the repeated words: all copies hidden, the different words and the box stay, Read back shows exactly what's left", async () => {
    const { jk } = await dupes();
    render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
    await screen.findByDisplayValue(BOX);
    expect(screen.getAllByText(PICKED)).toHaveLength(1);
    await removeInUi(PICKED);
    await waitFor(() => expect(screen.queryByText(PICKED)).toBeNull());
    await pause();
    expect(await allWords(jk)).toEqual([BOX, KEEP]);
    const days = await listLearned(jk, addDays(DAY, 1));
    const rb = render(<LearnedInReadBack day={days.find((d) => d.date === DAY)!} />);
    expect([...rb.container.querySelectorAll(".journal-past-answer")].map((p) => p.textContent)).toEqual([BOX, KEEP]);
    expect((await readJournalDays(jk, addDays(DAY, 2))).exercise?.notes.get(DAY)?.full ?? "").not.toContain(PICKED);
  });

  it("Add on the repeated words: in the box once, nothing of the box lost, every copy replaced", async () => {
    const { jk } = await dupes();
    render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
    const box = await screen.findByDisplayValue(BOX);
    await userEvent.click(within(blockOf(PICKED)).getByRole("button", { name: W.learnedMerge }));
    const want = `${BOX}\n\n${PICKED}`;
    await waitFor(() => expect(box).toHaveValue(want));
    await waitFor(async () => expect(await allWords(jk)).toEqual([want, KEEP]));
  });

  it("BUG: Add pressed twice quickly (a double click): her words go into the box once", async () => {
    const { jk } = await dupes();
    render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
    const box = await screen.findByDisplayValue(BOX);
    const add = within(blockOf(PICKED)).getByRole("button", { name: W.learnedMerge });
    await userEvent.dblClick(add);
    await pause(200);
    expect((box as HTMLTextAreaElement).value.split(PICKED).length - 1, "the added words, times in the box").toBe(1);
    await waitFor(async () => expect((await allWords(jk))[0]!.split(PICKED).length - 1).toBe(1));
  });

  it("a backup round trip (replace, then merge into an empty hub) keeps every removal as it was", async () => {
    const { jk } = await dupes();
    const d = await readLearned(jk, DAY);
    await removeLearnedVersion(jk, DAY, MAC, d.others.find((o) => o.text === PICKED)!.id);
    const want = await allWords(jk);
    for (const mode of ["replace", "merge"] as const) {
      const file = JSON.parse(JSON.stringify(await exportBackup("2026-11-05")));
      if (mode === "merge") {
        await Promise.all([db.journal.clear(), db.syncMeta.clear(), db.pending.clear(), db.quarantine.clear()]);
        await confirmedDevice(db, jk);
      }
      await restoreBackup(file, mode);
      expect(await allWords(jk), mode).toEqual(want);
    }
  });
});

// ---- restore-safe (round 5) ----------------------------------------------------------------------

describe("after a backup Replace, with the Journal still open (a box session that began before it)", () => {
  it("BUG: words she wrote after the backup (synced, so on the server under the former id) aren't hidden for good when she goes on typing", async () => {
    const { jk } = await journalDay(DAY, {});
    const before = await getDeviceId(db);
    render(<LearnedToday jk={jk} today={DAY} deviceId={before} />);
    const box = await screen.findByLabelText(W.learnedLabel);
    // 10:00 she writes, the box saves; she makes a backup.
    fireEvent.change(box, { target: { value: "Pretend Eskdale first words." } });
    fireEvent.blur(box);
    await waitFor(async () => expect((await readLearned(jk, DAY)).text).toBe("Pretend Eskdale first words."));
    const file = JSON.parse(JSON.stringify(await exportBackup(DAY)));
    // 10:05 she goes on in the same box: the session rewrites its row; it syncs to the server.
    await pause(5);
    fireEvent.change(box, { target: { value: "Pretend Eskdale first words. Pretend Fairholm words after the backup." } });
    fireEvent.blur(box);
    await waitFor(async () => expect((await readLearned(jk, DAY)).text).toContain("Fairholm"));
    const rows = await db.journal.where("kind").equals("learned").toArray();
    expect(rows, "set-up: one session row").toHaveLength(1);
    const onServer = rows[0]!;
    // Sync off, Replace with the backup (in another tab; this Journal stays open).
    await act(async () => void (await restoreBackup(file, "replace")));
    await waitFor(() => expect(box).toHaveValue("Pretend Eskdale first words."));
    // She types on in the box.
    await pause(5);
    fireEvent.change(box, { target: { value: "Pretend Eskdale first words. Pretend Glenridding words after the Replace." } });
    fireEvent.blur(box);
    await waitFor(async () => expect((await allWords(jk)).join("\n")).toContain("Glenridding"));
    // Sync on: the server's newer copy of the former-id row comes back.
    await act(async () => void (await db.journal.put(onServer)));
    await pause();
    expect((await allWords(jk)).join("\n"), "the words written after the backup are hidden on every device").toContain("Fairholm");
  });

  it("a fresh page after the Replace: her new words go under the current id, the restored version is replaced only as it was, nothing else lost", async () => {
    const { jk } = await journalDay(DAY, {});
    const before = await getDeviceId(db);
    const r = await saveLearned(jk, DAY, before, "Pretend Hawkshead words.");
    const file = JSON.parse(JSON.stringify(await exportBackup(DAY)));
    const newer = await saveLearned(jk, DAY, before, "Pretend Hawkshead words. Pretend Ings words after the backup.", { version: r });
    const onServer = (await db.journal.get(newer))!;
    await restoreBackup(file, "replace");
    const after = await getDeviceId(db);
    render(<LearnedToday jk={jk} today={DAY} deviceId={before} />);
    const box = await screen.findByDisplayValue("Pretend Hawkshead words.");
    fireEvent.change(box, { target: { value: "Pretend Hawkshead words. Pretend Keswick words." } });
    fireEvent.blur(box);
    await waitFor(async () => expect((await readLearned(jk, DAY)).text).toContain("Keswick"));
    const rows = await db.journal.where("kind").equals("learned").toArray();
    expect(rows.filter((x) => x.id.includes(`:${after}_`))).toHaveLength(1);
    await db.journal.put(onServer);
    expect((await allWords(jk)).join("\n")).toContain("Pretend Ings words after the backup.");
  });
});
