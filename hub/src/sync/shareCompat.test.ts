import Dexie from "dexie";
import { vi } from "vitest";
import { HubDB } from "../data/db";
import type { JournalRow } from "../domain/types";
import { journalAad, sealJson, type JournalKey } from "../journal/crypto";
import { keyFor } from "../test/journalKey";
import { FakeSyncServer } from "./fakeServer";
import { getMeta, saveSyncSettings, syncOnce } from "./engine";

// Two new journal kinds: the Together link's private tick ("share") and "what I learned today"
// ("learned"). An app version from before them (simulated: its validJournal refuses those kinds,
// as the previous release's does) must hold them in quarantine, keep syncing everything else, and
// apply them after an update. Made-up values only.

const older = vi.hoisted(() => ({ on: true }));
vi.mock("../data/validate", async (importOriginal) => {
  const real = await importOriginal<typeof import("../data/validate")>();
  return {
    ...real,
    validJournal: (r: unknown): r is JournalRow => real.validJournal(r) && !(older.on && ["share", "learned"].includes((r as { kind?: string }).kind ?? "")),
  };
});

const TOKEN = "5ba7".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const DAY = "2026-11-03";
let jk: JournalKey;
const open: HubDB[] = [];
beforeAll(async () => {
  jk = await keyFor("fake-journal-share-compat");
});
afterEach(async () => {
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function sealed(kind: JournalRow["kind"], id: string, entry: unknown): Promise<JournalRow> {
  return { id, kind, date: DAY, fp: jk.fp, ...(await sealJson(jk.key, entry, journalAad(id))), updatedAt: 0 };
}

it("an older app version quarantines the private tick and learned words (no crash), keeps syncing the rest, applies them after an update", async () => {
  const share = await sealed("share", `share:${DAY}:exercise`, { v: 1, private: true, at: 1 });
  const learned = await sealed("learned", `learned:${DAY}:device-phone-01`, { v: 1, text: "Pretend learned words", at: 1 });
  const page = await sealed("page", `page:${DAY}:3f2a1b4c-0000-4000-8000-000000000005`, { v: 1, text: "Pretend page", at: 2 });
  const server = new FakeSyncServer(TOKEN);
  const changes = [share, learned, page].map((r, i) => ({ table: "journal", id: r.id, updatedAt: 10 + i, data: { ...r, updatedAt: 10 + i } }));
  await server.fetch(`${SERVER}/v1/sync`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ deviceId: "newer-device-1", cursor: 0, changes }),
  });
  const old = new HubDB("share-compat-1");
  open.push(old);
  await saveSyncSettings(old, { serverUrl: SERVER, token: TOKEN });
  expect((await syncOnce({ db: old, fetch: server.fetch })).kind).toBe("ok");
  expect(await old.journal.get(page.id)).toBeTruthy();
  expect(await old.journal.get(share.id)).toBeUndefined();
  expect(await old.journal.get(learned.id)).toBeUndefined();
  expect((await old.quarantine.toArray()).map((q) => q.id).sort()).toEqual([learned.id, share.id].sort());
  expect(await getMeta(old, "cursor")).toBe(server.seq);
  expect((await syncOnce({ db: old, fetch: server.fetch })).kind).toBe("ok");
  expect(await old.pending.count()).toBe(0);

  older.on = false; // the update
  await syncOnce({ db: old, fetch: server.fetch });
  expect(await old.journal.get(share.id)).toMatchObject({ kind: "share" });
  expect(await old.journal.get(learned.id)).toMatchObject({ kind: "learned" });
  expect(await old.quarantine.count()).toBe(0);
});
