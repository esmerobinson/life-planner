import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { HubDB } from "../data/db";
import {
  JOURNAL_CANDIDATE_META, JOURNAL_DEVICE_WRAP_META, JOURNAL_KEY_META, JOURNAL_PENDING_WRAP_META, JOURNAL_RETIRED_META, journalKeyUnreadable,
  unlockJournal,
} from "./keyStore";
import { deriveToken } from "../sync/token";
import { JOURNAL_KEY_LOST_META, KEY_ROWS, checkRowRaw, dropUnreadableKeys, type RowCheck } from "./unreadableKeys";

let n = 0;
const dbs: HubDB[] = [];
async function fresh(): Promise<HubDB> {
  const db = new HubDB(`unreadable-keys-${n++}`);
  dbs.push(db);
  await db.open();
  return db;
}
afterEach(async () => {
  for (const db of dbs.splice(0)) {
    db.close();
    await db.delete();
  }
});

describe("unreadable journal keys (WebKit: a CryptoKey stored under another master key)", () => {
  it("names every row the key store keeps a CryptoKey in (the re-key adds the device wrap key and the pending wrap)", () => {
    expect([...KEY_ROWS].sort()).toEqual(
      [JOURNAL_CANDIDATE_META, JOURNAL_KEY_META, JOURNAL_RETIRED_META, JOURNAL_DEVICE_WRAP_META, JOURNAL_PENDING_WRAP_META].sort(),
    );
  });

  it("removes only the rows that can't be read, without reading them, and remembers a lost confirmed key", async () => {
    const db = await fresh();
    await db.syncMeta.bulkPut([
      { key: JOURNAL_KEY_META, value: { fp: "a" } },
      { key: JOURNAL_RETIRED_META, value: [] },
      { key: "deviceId", value: "dev-1" },
    ]);
    const answers: Record<string, RowCheck> = { [JOURNAL_KEY_META]: "unreadable", [JOURNAL_RETIRED_META]: "readable", [JOURNAL_CANDIDATE_META]: "absent" };
    const dropped = await dropUnreadableKeys(db, async (k) => answers[k]);
    expect(dropped).toEqual([JOURNAL_KEY_META]);
    expect(await db.syncMeta.get(JOURNAL_KEY_META)).toBeUndefined();
    expect(await db.syncMeta.get(JOURNAL_RETIRED_META)).toBeDefined();
    expect((await db.syncMeta.get("deviceId"))?.value).toBe("dev-1");
    expect((await db.syncMeta.get(JOURNAL_KEY_LOST_META))?.value).toBe(true);
    // The Journal then asks for the passphrase once more (not a plain first-time Unlock).
    expect(await journalKeyUnreadable(db)).toBe(true);
  });

  it("leaves everything alone when the check can't tell (it timed out or failed some other way)", async () => {
    const db = await fresh();
    await db.syncMeta.put({ key: JOURNAL_KEY_META, value: { fp: "a" } });
    expect(await dropUnreadableKeys(db, async () => "unknown")).toEqual([]);
    expect(await db.syncMeta.get(JOURNAL_KEY_META)).toBeDefined();
    expect(await db.syncMeta.get(JOURNAL_KEY_LOST_META)).toBeUndefined();
  });

  it("a never-answering check doesn't hold the app up", async () => {
    const db = await fresh();
    await db.syncMeta.put({ key: JOURNAL_KEY_META, value: { fp: "a" } });
    const started = Date.now();
    expect(await dropUnreadableKeys(db, () => new Promise<RowCheck>(() => undefined), 50)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(await db.syncMeta.get(JOURNAL_KEY_META)).toBeDefined();
  });

  it("checkRowRaw reads a normal row as readable and a missing one as absent", async () => {
    const db = await fresh();
    await db.syncMeta.put({ key: JOURNAL_RETIRED_META, value: [] });
    expect(await checkRowRaw(db.backendDB(), JOURNAL_RETIRED_META)).toBe("readable");
    expect(await checkRowRaw(db.backendDB(), JOURNAL_CANDIDATE_META)).toBe("absent");
  });

  it("checkRowRaw calls WebKit's 'Cannot inject key' failure (thrown by cursor.value) unreadable", async () => {
    // What WebKit did with her real data (2026-11-02): the cursor arrives, reading its value throws.
    const fakeDb = (valueError: Error | null) =>
      ({
        transaction: () => ({
          objectStore: () => ({
            openCursor: () => {
              const cursor = {
                get value() {
                  if (valueError) throw valueError;
                  return { key: JOURNAL_KEY_META };
                },
              };
              const req: { onsuccess?: () => void; result: unknown } = { result: cursor };
              setTimeout(() => req.onsuccess?.(), 0);
              return req;
            },
          }),
        }),
      }) as unknown as IDBDatabase;
    const unknownError = new DOMException("Cannot inject key into script value", "UnknownError");
    expect(await checkRowRaw(fakeDb(unknownError), JOURNAL_KEY_META)).toBe("unreadable");
    expect(await checkRowRaw(fakeDb(new Error("something else")), JOURNAL_KEY_META)).toBe("unknown");
    expect(await checkRowRaw(fakeDb(null), JOURNAL_KEY_META)).toBe("readable");
  });

  it("typing the passphrase again clears the lost-key note", async () => {
    const db = await fresh();
    await db.syncMeta.put({ key: JOURNAL_KEY_LOST_META, value: true });
    const pass = "correct horse battery staple";
    await db.syncMeta.put({ key: "token", value: await deriveToken(pass) }); // sync set up with this passphrase
    expect(await unlockJournal(db, pass)).toBe("checking");
    expect(await db.syncMeta.get(JOURNAL_KEY_LOST_META)).toBeUndefined();
  });
});
