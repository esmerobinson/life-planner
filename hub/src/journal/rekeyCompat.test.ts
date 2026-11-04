import Dexie from "dexie";
import { db, HubDB } from "../data/db";
import { exportBackup, restoreBackup } from "../data/backup";
import { validJournal } from "../data/validate";
import { FakeSyncServer } from "../sync/fakeServer";
import { saveSyncSettings, syncOnce } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { deriveJournalSecret, deriveKeyWrapKey, journalAad, sealJson, toBase64 } from "./crypto";
import { keyWrapId } from "./keyStore";
import { keyFor } from "../test/journalKey";

// Journal re-key (journal-rekey brief): the new `keywrap` rows survive a backup, and an app
// version from before the update keeps them in quarantine (unknown kind) and syncs on.
// Fictional passphrases only.

const SERVER = "https://sync.example.test";
const DAY = "2026-11-04";

async function keywrapRow() {
  const kek = await deriveKeyWrapKey("pretend-compat-new");
  const id = keyWrapId(kek.fp);
  const s = await deriveJournalSecret("pretend-compat-old");
  const sealed = await sealJson(kek.key, { v: 1, s: toBase64(s), fp: (await keyFor("pretend-compat-old")).fp }, journalAad(id));
  return { id, kind: "keywrap" as const, date: DAY, fp: kek.fp, ...sealed };
}

const others: HubDB[] = [];
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear(), db.items.clear(), db.goals.clear(), db.files.clear()]);
});
afterEach(async () => {
  vi.doUnmock("../domain/types");
  vi.resetModules();
  for (const d of others.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

it("a keywrap row is a valid journal row only with its own id shape", async () => {
  const row = await keywrapRow();
  expect(validJournal(row)).toBe(true);
  expect(validJournal({ ...row, id: `keywrap:${DAY}:x` })).toBe(false);
  expect(validJournal({ ...row, id: "keywrap:ABCDEF0123456789" })).toBe(false);
  expect(validJournal({ ...row, s: "anything in clear" })).toBe(false);
});

it("backup and restore keep keywrap rows exactly", async () => {
  const row = await keywrapRow();
  await db.journal.put(row);
  const file = JSON.parse(JSON.stringify(await exportBackup(DAY)));
  expect(file.journal.map((r: { kind: string }) => r.kind)).toEqual(["keywrap"]);
  await db.journal.clear();
  await restoreBackup(file, "replace");
  expect(await db.journal.get(row.id)).toMatchObject({ kind: "keywrap", fp: row.fp, iv: row.iv, ct: row.ct });
  await db.journal.clear();
  await restoreBackup(file, "merge");
  expect(await db.journal.get(row.id)).toMatchObject({ ct: row.ct });
});

it("an app version without the keywrap kind keeps the row in quarantine and keeps syncing", async () => {
  const token = await deriveToken("pretend-compat-new");
  const server = new FakeSyncServer(token);
  const updated = new HubDB(`rekey-compat-new-${Date.now()}`);
  others.push(updated);
  await saveSyncSettings(updated, { serverUrl: SERVER, token });
  const row = await keywrapRow();
  await updated.journal.put(row);
  expect((await syncOnce({ db: updated, fetch: server.fetch })).kind).toBe("ok");

  // The same modules as an older build: its kind list has no "keywrap".
  vi.resetModules();
  vi.doMock("../domain/types", async (importOriginal) => {
    const m = await importOriginal<typeof import("../domain/types")>();
    return { ...m, JOURNAL_KINDS: m.JOURNAL_KINDS.filter((k) => k !== "keywrap") };
  });
  const older = await import("../data/db");
  const olderEngine = await import("../sync/engine");
  const olderValidate = await import("../data/validate");
  expect(olderValidate.validJournal(row)).toBe(false);
  const old = new older.HubDB(`rekey-compat-old-${Date.now()}`);
  others.push(old);
  await olderEngine.saveSyncSettings(old, { serverUrl: SERVER, token });
  expect((await olderEngine.syncOnce({ db: old, fetch: server.fetch })).kind).toBe("ok");
  expect(await old.journal.get(row.id)).toBeUndefined();
  expect(await old.quarantine.get(["journal", row.id])).toMatchObject({ id: row.id });
  expect((await olderEngine.syncOnce({ db: old, fetch: server.fetch })).kind).toBe("ok");
});
