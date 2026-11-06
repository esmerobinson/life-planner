// KNOWN BUG (restore-safe review I3, outside the journal; to be filed in bugs.md): tasks and
// goals have the same overwrite after a Replace as bug #31 had for the journal. She improves a
// task's (or goal's) notes after a backup (synced), turns sync off, Replaces with the older
// backup, edits that task, and turns sync on: her edit gets a fresh stamp on the same shared row,
// so the newer notes are gone from every device. A new device id can't help here: these rows
// are shared by every device, not one per device.
// `it.fails`: these pass while the bug is there; when it is fixed they fail, and become `it`.
// Fictional words only; fake server only.

import Dexie from "dexie";
import { db, HubDB } from "../data/db";
import { exportBackup, restoreBackup } from "../data/backup";
import { createGoal, createItem, updateGoal, updateItem } from "../data/repo";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, stopSyncing, syncOnce } from "./engine";

const TOKEN = "7a5c".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const TODAY = "2026-11-05";
const open: HubDB[] = [];
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear(), db.items.clear(), db.goals.clear(), db.files.clear()]);
});
afterEach(async () => {
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});
const later = () => new Promise((r) => setTimeout(r, 5));

async function story(make: () => Promise<string>, edit: (id: string, notes: string) => Promise<void>, read: (d: HubDB, id: string) => Promise<string | undefined>) {
  const server = new FakeSyncServer(TOKEN);
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  const id = await make();
  await syncOnce({ db, fetch: server.fetch });
  const backup = JSON.parse(JSON.stringify(await exportBackup(TODAY)));
  await later();
  await edit(id, "Pretend newer notes");
  await syncOnce({ db, fetch: server.fetch });
  await stopSyncing(db);
  await restoreBackup(backup, "replace");
  await later();
  await edit(id, "Pretend notes after the restore");
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  await syncOnce({ db, fetch: server.fetch });
  const phone = new HubDB(`testing-restore-task-phone-${Math.random()}`);
  open.push(phone);
  await saveSyncSettings(phone, { serverUrl: SERVER, token: TOKEN });
  await syncOnce({ db: phone, fetch: server.fetch });
  // The newer notes should still be somewhere on each device; today they are on none.
  for (const d of [db, phone]) expect(JSON.stringify(await read(d, id))).toContain("Pretend newer notes");
}

it.fails("a task: Replace an older backup, edit it offline, sync on: the newer notes are kept somewhere", async () => {
  await story(
    async () => (await createItem({ kind: "task", title: "Pretend task", areaId: "writing", priority: 2, notes: "Pretend first notes" }, TODAY)).id,
    (id, notes) => updateItem(id, { notes }, TODAY),
    async (d, id) => (await d.items.get(id))?.notes,
  );
});

it.fails("a goal: Replace an older backup, edit it offline, sync on: the newer notes are kept somewhere", async () => {
  await story(
    async () => (await createGoal({ title: "Pretend goal", areaId: "writing", kind: "practice", notes: "Pretend first notes" }, TODAY)).id,
    (id, notes) => updateGoal(id, { notes }, TODAY),
    async (d, id) => (await d.goals.get(id))?.notes,
  );
});
