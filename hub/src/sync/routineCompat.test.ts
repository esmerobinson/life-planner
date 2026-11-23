import Dexie from "dexie";
import { vi } from "vitest";
import { HubDB } from "../data/db";
import type { JournalRow } from "../domain/types";
import { journalAad, sealJson, type JournalKey } from "../journal/crypto";
import { keyFor } from "../test/journalKey";
import { FakeSyncServer } from "./fakeServer";
import { getMeta, saveSyncSettings, syncOnce } from "./engine";

// New journal kinds: the daily log ("day-log"), the weekly review ("week-review") and the weekly
// review in its own tab (v2, "weekly-review", filed under its Monday). An app
// version from before them (simulated: its validJournal refuses those kinds, as the previous
// release's does) must hold them in quarantine, keep syncing everything else, and apply them after
// an update. Made-up values only.

const older = vi.hoisted(() => ({ on: true }));
vi.mock("../data/validate", async (importOriginal) => {
  const real = await importOriginal<typeof import("../data/validate")>();
  return {
    ...real,
    validJournal: (r: unknown): r is JournalRow => real.validJournal(r) && !(older.on && ["day-log", "week-review", "weekly-review"].includes((r as { kind?: string }).kind ?? "")),
  };
});

const TOKEN = "5ba7".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const DAY = "2026-11-15";
let jk: JournalKey;
const open: HubDB[] = [];
beforeAll(async () => {
  jk = await keyFor("fake-journal-routine-compat");
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

it("an older app version quarantines the daily log and weekly review (no crash), keeps syncing the rest, applies them after an update", async () => {
  const share = await sealed("day-log", `day-log:${DAY}:device-phone-01_a1`, { v: 1, schedule: "yes", scheduleNote: "", todos: null, todosNote: "", submittedAt: 1, at: 1 });
  const learned = await sealed("week-review", `week-review:${DAY}:device-phone-01_b2`, { v: 1, well: "Pretend review words", inWay: "", values: 6, ifThen: "", minDays: [], submittedAt: 1, at: 1 });
  const v2 = { ...(await sealed("weekly-review", "weekly-review:2026-11-09:device-phone-01_c3", {
    v: 1, submittedAt: 1, at: 1, doneOn: DAY, selfHarm: "no", selfHarmWhat: "", urges: null, urgesNote: "", fight: null, fightAbout: "", fightTrigger: "",
    fightResolved: "", productive: null, achieved: "", struggled: "", well: "Pretend v2 words", inWay: "", values: null, ifThen: "", minDays: [],
    dbt: "", sleep: null, sleepNote: "", proud: "", more: "",
  })), date: "2026-11-09" };
  const page = await sealed("page", `page:${DAY}:3f2a1b4c-0000-4000-8000-000000000005`, { v: 1, text: "Pretend page", at: 2 });
  const server = new FakeSyncServer(TOKEN);
  const changes = [share, learned, v2, page].map((r, i) => ({ table: "journal", id: r.id, updatedAt: 10 + i, data: { ...r, updatedAt: 10 + i } }));
  await server.fetch(`${SERVER}/v1/sync`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ deviceId: "newer-device-1", cursor: 0, changes }),
  });
  const old = new HubDB("routine-compat-1");
  open.push(old);
  await saveSyncSettings(old, { serverUrl: SERVER, token: TOKEN });
  expect((await syncOnce({ db: old, fetch: server.fetch })).kind).toBe("ok");
  expect(await old.journal.get(page.id)).toBeTruthy();
  expect(await old.journal.get(share.id)).toBeUndefined();
  expect(await old.journal.get(learned.id)).toBeUndefined();
  expect(await old.journal.get(v2.id)).toBeUndefined();
  expect((await old.quarantine.toArray()).map((q) => q.id).sort()).toEqual([learned.id, share.id, v2.id].sort());
  expect(await getMeta(old, "cursor")).toBe(server.seq);
  expect((await syncOnce({ db: old, fetch: server.fetch })).kind).toBe("ok");
  expect(await old.pending.count()).toBe(0);

  older.on = false; // the update
  await syncOnce({ db: old, fetch: server.fetch });
  expect(await old.journal.get(share.id)).toMatchObject({ kind: "day-log" });
  expect(await old.journal.get(learned.id)).toMatchObject({ kind: "week-review" });
  expect(await old.journal.get(v2.id)).toMatchObject({ kind: "weekly-review", date: "2026-11-09" });
  expect(await old.quarantine.count()).toBe(0);
});
