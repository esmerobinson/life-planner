import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { exportBackup, restoreBackup } from "../../data/backup";
import { db } from "../../data/db";
import { readLearned, saveLearned } from "../../data/repo";
import type { JournalRow } from "../../domain/types";
import { journalAad, sealJson, type JournalKey } from "../../journal/crypto";
import { getDeviceId } from "../../sync/engine";
import { emptyDb, journalDay } from "../../together/testKit";
import { LearnedToday } from "./LearnedToday";
import { TOGETHER_WORDS as W } from "./wording";

// Testing session (Life Planner - Together-link Round 6 Testing), 2026-11-06. Round 6's #60
// (the former-id row is replaced only as it was, id@stamp) across a second Replace, and #61
// (Add once per click) with more clicks and two devices. Made-up words only.

beforeEach(emptyDb);

const DAY = "2026-11-04";
const MAC = "device-pretend-mac-01";
const PHONE = "device-pretend-phone-1";
const IPAD = "device-pretend-ipad-9";
const BOX = "Pretend Lowther Mac lesson: rest counts.";
const PICK1 = "Pretend Mardale phone lesson: name the feeling.";
const PICK2 = "Pretend Nethermost iPad lesson: drink water.";

let vid = 0;
async function versionRow(jk: JournalKey, device: string, text: string, at: number, opts: { seen?: string[]; id?: string } = {}): Promise<JournalRow> {
  const id = opts.id ?? `learned:${DAY}:${device}_r6${(++vid).toString(36)}`;
  return { id, kind: "learned", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text, at, ...(opts.seen ? { seen: opts.seen } : {}) }, journalAad(id))) };
}
const allWords = async (jk: JournalKey) => {
  const d = await readLearned(jk, DAY);
  return [d.text, ...d.others.map((o) => o.text)];
};
const blockOf = (text: string) => screen.getByText(text).closest(".together-learned-other") as HTMLElement;
const pause = (ms = 60) => act(() => new Promise((r) => setTimeout(r, ms)));
const times = (s: string, w: string) => s.split(w).length - 1;

async function twoOthers() {
  const { jk } = await journalDay(DAY, {});
  const now = Date.now();
  await db.journal.bulkPut([await versionRow(jk, PHONE, PICK1, now - 60_000), await versionRow(jk, IPAD, PICK2, now - 50_000)]);
  await saveLearned(jk, DAY, MAC, BOX);
  return { jk };
}

describe("#61: Add, more ways", () => {
  it("three quick clicks on Add: in the box once", async () => {
    const { jk } = await twoOthers();
    render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
    const box = (await screen.findByDisplayValue(BOX)) as HTMLTextAreaElement;
    const add = within(blockOf(PICK1)).getByRole("button", { name: W.learnedMerge });
    await userEvent.tripleClick(add);
    await pause(200);
    expect(times(box.value, PICK1)).toBe(1);
    await waitFor(async () => expect(times((await allWords(jk))[0]!, PICK1)).toBe(1));
  });

  it("Add on one version then at once on another: both go into the box, once each, nothing lost", async () => {
    const { jk } = await twoOthers();
    render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
    const box = (await screen.findByDisplayValue(BOX)) as HTMLTextAreaElement;
    const a1 = within(blockOf(PICK1)).getByRole("button", { name: W.learnedMerge });
    const a2 = within(blockOf(PICK2)).getByRole("button", { name: W.learnedMerge });
    fireEvent.click(a1);
    fireEvent.click(a2);
    fireEvent.click(a1);
    await pause(200);
    expect(box.value).toBe(`${BOX}\n\n${PICK1}\n\n${PICK2}`);
    await waitFor(async () => expect(await allWords(jk)).toEqual([`${BOX}\n\n${PICK1}\n\n${PICK2}`]));
  });

  it("Add on the same version on two devices at once (Mac here, the phone by sync): nothing lost, the added version no longer shown on its own", async () => {
    const { jk } = await twoOthers();
    const d = await readLearned(jk, DAY);
    const picked = d.others.find((o) => o.text === PICK2)!;
    render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
    const box = (await screen.findByDisplayValue(BOX)) as HTMLTextAreaElement;
    // The phone, meanwhile, adds the iPad's words to its own box (its version replaces the iPad's).
    const phoneWords = `${PICK1}\n\n${PICK2}`;
    await act(async () => void (await db.journal.put(await versionRow(jk, PHONE, phoneWords, Date.now() + 5, { seen: [...picked.seen, ...d.others.find((o) => o.text === PICK1)!.seen] }))));
    fireEvent.click(within(await waitFor(() => blockOf(PICK2))).getByRole("button", { name: W.learnedMerge }));
    await pause(200);
    expect(times(box.value, PICK2)).toBe(1);
    await waitFor(async () => {
      const words = (await allWords(jk)).join("\n\n");
      expect(words).toContain(BOX);
      expect(words).toContain(PICK1);
      expect(words).toContain(PICK2);
    });
    const left = await readLearned(jk, DAY);
    expect([left, ...left.others].some((v) => v.text === PICK2), "the iPad's version still shown on its own").toBe(false);
  });
});

describe("#60 across two Replaces in another tab (the Journal open throughout)", () => {
  it("words written after each backup (synced: newer copies of the former-id rows) show again once they arrive; nothing she typed is lost", async () => {
    const { jk } = await journalDay(DAY, {});
    const id0 = await getDeviceId(db);
    render(<LearnedToday jk={jk} today={DAY} deviceId={id0} />);
    const box = await screen.findByLabelText(W.learnedLabel);
    const type = async (value: string, check: string) => {
      await pause(5);
      fireEvent.change(box, { target: { value } });
      fireEvent.blur(box);
      await waitFor(async () => expect((await allWords(jk)).join("\n")).toContain(check));
    };
    await type("Pretend Ormside one.", "Ormside one");
    const file1 = JSON.parse(JSON.stringify(await exportBackup(DAY)));
    await type("Pretend Ormside one. Pretend Patterdale after backup one.", "Patterdale");
    const server1 = (await db.journal.where("kind").equals("learned").toArray()).map((r) => ({ ...r }));
    await act(async () => void (await restoreBackup(file1, "replace")));
    await waitFor(() => expect(box).toHaveValue("Pretend Ormside one."));
    await type("Pretend Ormside one. Pretend Quarry after Replace one.", "Quarry");
    const file2 = JSON.parse(JSON.stringify(await exportBackup(DAY)));
    await type("Pretend Ormside one. Pretend Quarry after Replace one. Pretend Rydal after backup two.", "Rydal");
    const server2 = (await db.journal.where("kind").equals("learned").toArray()).map((r) => ({ ...r }));
    await act(async () => void (await restoreBackup(file2, "replace")));
    await waitFor(() => expect(box).toHaveValue("Pretend Ormside one. Pretend Quarry after Replace one."));
    await type("Pretend Ormside one. Pretend Quarry after Replace one. Pretend Shap after Replace two.", "Shap");
    // Sync on: the server's copies (newer than the restored ones) come back.
    await act(async () => void (await db.journal.bulkPut([...server2, ...server1])));
    await pause();
    const words = (await allWords(jk)).join("\n");
    for (const w of ["Patterdale", "Rydal", "Shap"]) expect(words, `${w}: words she typed are hidden`).toContain(w);
  });
});
