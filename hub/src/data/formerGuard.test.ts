// Restore-safe guard (review test gap): even if a writer were handed a former device id as the
// one to write with, the journal write path refuses the row and the restored row stays as it is.
// Fictional words only.

import { vi } from "vitest";
import { db } from "./db";
import { exportBackup, restoreBackup } from "./backup";
import { saveMorningDraft } from "./repo";
import { journalId } from "./validate";
import { getDeviceId } from "../sync/engine";
import { confirmedDevice, keyFor } from "../test/journalKey";

const broken = vi.hoisted(() => ({ on: false, id: "" }));
vi.mock("./deviceIds", async (importOriginal) => {
  const real = await importOriginal<typeof import("./deviceIds")>();
  return {
    ...real,
    ownDevices: async (d: string) => (broken.on ? { current: broken.id, former: [] } : real.ownDevices(d)),
  };
});

const DAY = "2026-11-05";
beforeEach(async () => {
  broken.on = false;
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear()]);
});

it("a write under a former device id is refused; the restored row is untouched", async () => {
  const jk = await keyFor("fake-journal-former-guard");
  await confirmedDevice(db, jk);
  const mac = await getDeviceId(db);
  await saveMorningDraft(jk, DAY, mac, "Pretend first lines.");
  await restoreBackup(JSON.parse(JSON.stringify(await exportBackup(DAY))), "replace");
  const restored = await db.journal.get(journalId("draft", DAY, mac));
  broken.on = true;
  broken.id = mac;
  await expect(saveMorningDraft(jk, DAY, mac, "Pretend words over it")).rejects.toThrow("could not be saved");
  expect(await db.journal.get(journalId("draft", DAY, mac))).toEqual(restored);
});
