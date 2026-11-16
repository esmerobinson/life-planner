// Restore-safe (bug #31) for the Together link's rows: after a Replace, "what I learned" and the
// private ticks still save (with this device's new id), nothing is refused, and nothing written
// under the former id is ever written again. Fictional words only.

import { db } from "./db";
import { exportBackup, restoreBackup } from "./backup";
import { formerDeviceIds } from "./deviceIds";
import { readLearned, readSharePrivate, removeLearnedVersion, saveLearned, saveSharePrivate } from "./repo";
import { getDeviceId } from "../sync/engine";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { journalAad, sealJson } from "../journal/crypto";

const DAY = "2026-11-05";

beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear()]);
});

async function replaced() {
  const jk = await keyFor("fake-journal-learned-replace");
  await confirmedDevice(db, jk);
  const before = await getDeviceId(db);
  const session = await saveLearned(jk, DAY, before, "Pretend Halloway words before the backup");
  await restoreBackup(JSON.parse(JSON.stringify(await exportBackup(DAY))), "replace");
  expect(await formerDeviceIds()).toContain(before);
  const after = await getDeviceId(db);
  expect(after).not.toBe(before);
  return { jk, before, after, session };
}

it("after a Replace, a page still holding the former id saves with the new id: never refused, the restored row untouched", async () => {
  const { jk, before, after, session } = await replaced();
  const restored = await db.journal.get(session);
  const id = await saveLearned(jk, DAY, before, "Pretend Halloway words after the Replace");
  expect(id.startsWith(`learned:${DAY}:${after}_`)).toBe(true);
  expect(await db.journal.get(session)).toEqual(restored);
  expect((await readLearned(jk, DAY)).text).toBe("Pretend Halloway words after the Replace");
});

it("a box session that began before the Replace goes on in a new version that replaces its own former row", async () => {
  const { jk, before, after, session } = await replaced();
  const id = await saveLearned(jk, DAY, before, "Pretend Halloway words, and more", { version: session });
  expect(id).not.toBe(session);
  expect(id.startsWith(`learned:${DAY}:${after}_`)).toBe(true);
  expect(await readLearned(jk, DAY)).toMatchObject({ text: "Pretend Halloway words, and more", others: [] });
});

it("Remove and the private ticks also work after a Replace", async () => {
  const { jk, before, after } = await replaced();
  const pid = `learned:${DAY}:device-pretend-phone_x1`;
  await db.journal.put({ id: pid, kind: "learned", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text: "Pretend phone words", at: 1 }, journalAad(pid))) });
  const day = await readLearned(jk, DAY);
  const other = [day, ...day.others].find((v) => v.device === "device-pretend-phone")!;
  const id = await removeLearnedVersion(jk, DAY, before, other.id);
  expect(id.startsWith(`learned:${DAY}:${after}_`)).toBe(true);
  await saveSharePrivate(jk, DAY, "checkin", true);
  expect(await readSharePrivate(jk, DAY)).toEqual({ exercise: false, checkin: true });
});
