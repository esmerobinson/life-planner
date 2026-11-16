// Review m5 (c), with bug #31: journal rows a restore keeps for a newer app version (a kind this
// version doesn't know yet) wait in quarantine. After the update they are applied AND sent, so
// they reach the server and every other device; until then they stay here (and in backups).
// A newer copy on the server still wins. Rows that came from the server are only applied.
// Fictional rows only; fake server only.

import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import { restoreBackup } from "../data/backup";
import { toBase64 } from "../journal/crypto";
import type { JournalRow } from "../domain/types";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// "An app update": a later build reads the journal kind "future-kind"; this build does not yet.
const update = vi.hoisted(() => ({ knowsFuture: false }));
vi.mock("../data/validate", async (importOriginal) => {
  const real = await importOriginal<typeof import("../data/validate")>();
  return {
    ...real,
    validJournal: (r: unknown): r is JournalRow =>
      real.validJournal(r) || (update.knowsFuture && (r as { kind?: string }).kind === "future-kind" && real.sealedJournalShape(r)),
  };
});

const TOKEN = "f00d".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const DAY = "2026-11-05";
const ID = `future-kind:${DAY}:pretend-0001`;
const future = (updatedAt: number, ct = "AAAAAAAAAAAAAAAAAAAAAA==") => ({
  id: ID, kind: "future-kind", date: DAY, fp: "0123456789abcdef", iv: toBase64(new Uint8Array(12)), ct, updatedAt,
});
const file = (rows: unknown[]) => ({ app: "life-hub", schema: 1, exportedOn: DAY, items: [], goals: [], journal: rows });

const open: HubDB[] = [];
beforeEach(async () => {
  update.knowsFuture = false;
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear(), db.items.clear(), db.goals.clear(), db.files.clear()]);
});
afterEach(async () => {
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function phone(server: FakeSyncServer) {
  const d = new HubDB(`restore-quarantine-phone-${Math.random()}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("ok");
  return d;
}

it.each(["replace", "merge"] as const)("%s: a row kept for a newer version is sent once this version can read it, and reaches the phone", async (mode) => {
  const server = new FakeSyncServer(TOKEN);
  expect(await restoreBackup(file([future(1_700_000_000_000)]), mode)).toMatchObject({ kept: 1 });
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  // Not readable yet: it waits here, nothing of it is sent.
  expect(await db.quarantine.count()).toBe(1);
  expect(server.data("journal", ID)).toBeUndefined();

  update.knowsFuture = true;
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  expect(await db.journal.get(ID)).toMatchObject({ kind: "future-kind", updatedAt: 1_700_000_000_000 });
  expect(await db.quarantine.count()).toBe(0);
  expect(await db.pending.count()).toBe(0);
  expect(server.data("journal", ID)).toMatchObject({ kind: "future-kind", updatedAt: 1_700_000_000_000 });
  expect(await (await phone(server)).journal.get(ID)).toMatchObject({ kind: "future-kind" });
});

it("a newer copy of that row on the server still wins over the one from the backup", async () => {
  const server = new FakeSyncServer(TOKEN);
  const NEWER = "BBBBBBBBBBBBBBBBBBBBBB==";
  await server.fetch(`${SERVER}/v1/sync`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ deviceId: "newer-device-1", cursor: 0, changes: [{ table: "journal", id: ID, updatedAt: 1_700_000_000_500, data: future(1_700_000_000_500, NEWER) }] }),
  });
  await restoreBackup(file([future(1_700_000_000_000)]), "replace");
  update.knowsFuture = true;
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  expect(await db.journal.get(ID)).toMatchObject({ ct: NEWER, updatedAt: 1_700_000_000_500 });
  expect(server.data("journal", ID)).toMatchObject({ ct: NEWER });
  expect(await db.pending.count()).toBe(0);
});

it("a row the server sent (not a backup's) is applied after the update but not sent back", async () => {
  const server = new FakeSyncServer(TOKEN);
  await server.fetch(`${SERVER}/v1/sync`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ deviceId: "newer-device-1", cursor: 0, changes: [{ table: "journal", id: ID, updatedAt: 1_700_000_000_000, data: future(1_700_000_000_000) }] }),
  });
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  expect(await db.quarantine.count()).toBe(1);
  update.knowsFuture = true;
  const before = server.syncRequests.length;
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  expect(await db.journal.get(ID)).toMatchObject({ kind: "future-kind" });
  expect(server.syncRequests.slice(before).flatMap((r) => r.body?.changes ?? [])).toEqual([]);
});
