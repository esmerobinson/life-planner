import { vi } from "vitest";
import { db } from "./db";
import { moveAnswerOn, readCheckinDay, saveAnswer } from "./repo";
import type { JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";

// A finished check-in's Edit (fix round 2): each Edit writes its own new rows, never over an
// earlier row (bug #24: a device restored from an older backup can't overwrite newer words it
// hasn't seen), and an answer cleared on purpose wins over an older one from another device
// (bug #30), while Skip or an empty box never erases another device's words. Fictional words only.

const DAY = "2026-10-28";
const ME = "device-mac-0001";
const PHONE = "device-phone-01";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-checkin-edit-repo");
});
let clock = 1_800_000_000_000;
beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock++);
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
});
afterEach(() => vi.restoreAllMocks());

const answerRows = () => db.journal.where("kind").equals("answer").toArray();

it("each Edit is its own row: a later Edit never writes over an earlier one", async () => {
  await saveAnswer(jk, DAY, "M1", ME, "Pretend first", true);
  await saveAnswer(jk, DAY, "M1", ME, "Pretend edit one", true, { session: "aaaa1" });
  await saveAnswer(jk, DAY, "M1", ME, "Pretend edit one, more", true, { session: "aaaa1" }); // same Edit, typing on
  await saveAnswer(jk, DAY, "M1", ME, "Pretend edit two", true, { session: "bbbb2" });
  expect(await answerRows()).toHaveLength(3);
  expect((await readCheckinDay(jk, DAY)).answers.get("M1")).toMatchObject({ answer: "Pretend edit two", done: true });
});

it("cleared on purpose with Edit: wins over another device's older words", async () => {
  await saveAnswer(jk, DAY, "M1", PHONE, "Pretend phone words", true);
  await saveAnswer(jk, DAY, "M1", ME, "", true, { session: "ccc3" });
  expect((await readCheckinDay(jk, DAY)).answers.get("M1")).toMatchObject({ answer: null, done: true, cleared: true });
  // Newer words after the clear show again.
  await saveAnswer(jk, DAY, "M1", PHONE, "Pretend phone words, again", true);
  expect((await readCheckinDay(jk, DAY)).answers.get("M1")?.answer).toBe("Pretend phone words, again");
});

it("Skip, Next with nothing typed, or an empty box never erases another device's words", async () => {
  await saveAnswer(jk, DAY, "M1", PHONE, "Pretend phone words", true);
  await moveAnswerOn(jk, DAY, "M1", ME);
  await saveAnswer(jk, DAY, "M1", ME, "", true);
  expect((await readCheckinDay(jk, DAY)).answers.get("M1")?.answer).toBe("Pretend phone words");
});

it("an Edit is newer than the answer she had in front of her, whatever this device's clock says (bug #32)", async () => {
  clock = 1_800_000_600_000; // the phone's clock, ten minutes ahead
  await saveAnswer(jk, DAY, "M1", PHONE, "Pretend phone words", true);
  const seenAt = (await readCheckinDay(jk, DAY)).answers.get("M1")!.at;
  clock = 1_800_000_000_000; // the Mac's clock
  await saveAnswer(jk, DAY, "M1", ME, "Pretend phone words, changed on the Mac", true, { session: "ddd4", seenAt });
  expect((await readCheckinDay(jk, DAY)).answers.get("M1")?.answer).toBe("Pretend phone words, changed on the Mac");
});

it("Skip with nothing new typed keeps the time its words were typed (bug #33)", async () => {
  await saveAnswer(jk, DAY, "M1", PHONE, "Pretend first thought on the phone", false);
  await saveAnswer(jk, DAY, "M1", ME, "Pretend proper answer on the Mac", true);
  await moveAnswerOn(jk, DAY, "M1", PHONE);
  const day = await readCheckinDay(jk, DAY);
  expect(day.answers.get("M1")).toMatchObject({ answer: "Pretend proper answer on the Mac", done: true });
});
