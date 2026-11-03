import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import { createItem, setSessionDone, updateSession } from "../data/repo";
import type { Item } from "../domain/types";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// Two devices ticking different sessions of one project between syncs (fix round 1, I-4):
// rows are last-write-wins, so without a merge the older device's tick would vanish. The
// phone here is the app's own database (the repo writes to it); the Mac is a second one.
// Pretend data only.

const TOKEN = "cafe".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const TODAY = "2026-11-02";
let clock = 1_800_000_000_000;
let n = 0;
const open: HubDB[] = [];

beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await db.items.clear();
  await db.goals.clear();
  await db.pending.clear();
  await db.syncMeta.clear();
  await db.quarantine.clear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function mac() {
  const d = new HubDB(`mac-ticks-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

/** The Mac ticks (or unticks) a session the way its repo would: a tracked write of the whole row. */
async function macSets(d: HubDB, id: string, sessionId: string, doneOn: string | undefined) {
  const row = (await d.items.get(id))!;
  const sessions = row.sessions!.map((s) => {
    if (s.id !== sessionId) return s;
    const { doneOn: _d, ...rest } = s;
    return doneOn ? { ...rest, doneOn } : rest;
  });
  await d.items.put({ ...row, sessions, touchedAt: TODAY });
}

async function setUp() {
  const server = new FakeSyncServer(TOKEN);
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  const p = await createItem(
    {
      kind: "task", title: "Pretend street scene", areaId: "art", priority: 2, due: "2026-11-09",
      sessions: [{ id: "s1" }, { id: "s2" }, { id: "s3", title: "Pretend lighting" }, { id: "s4" }],
    },
    "2026-10-29",
  );
  await syncOnce({ db, fetch: server.fetch });
  const m = await mac();
  await syncOnce({ db: m, fetch: server.fetch });
  expect((await m.items.get(p.id))!.sessions).toHaveLength(4);
  return { server, m, id: p.id };
}

const done = (row: Item | undefined) => (row?.sessions ?? []).filter((s) => s.doneOn).map((s) => s.id);

describe("session ticks from two devices", () => {
  it("each device ticks a different session between syncs: both ticks survive everywhere", async () => {
    const { server, m, id } = await setUp();
    clock += 60_000;
    await setSessionDone(id, "s1", true, TODAY); // the phone, offline
    clock += 60_000;
    await macSets(m, id, "s2", TODAY); // the Mac, later (its row is newer)
    await syncOnce({ db: m, fetch: server.fetch });

    await syncOnce({ db, fetch: server.fetch }); // the phone's older row loses; its tick is carried over
    expect(done(await db.items.get(id))).toEqual(["s1", "s2"]);
    await syncOnce({ db, fetch: server.fetch }); // and sent
    expect(done(server.data("items", id) as unknown as Item)).toEqual(["s1", "s2"]);
    await syncOnce({ db: m, fetch: server.fetch });
    expect(done(await m.items.get(id))).toEqual(["s1", "s2"]);
    expect(await db.pending.count()).toBe(0);
    expect(await db.syncMeta.get(`sessionTicks:${id}`)).toBeUndefined(); // accepted: forgotten
  });

  it("a local untick is carried too, and nothing else is merged (the newer row's other fields win)", async () => {
    const { server, m, id } = await setUp();
    await setSessionDone(id, "s3", true, TODAY);
    await syncOnce({ db, fetch: server.fetch });
    await syncOnce({ db: m, fetch: server.fetch });
    clock += 60_000;
    await setSessionDone(id, "s3", false, TODAY); // the phone unticks s3
    await updateSession(id, "s4", { title: "Pretend phone title" }, TODAY); // not a tick: not carried
    clock += 60_000;
    await macSets(m, id, "s1", TODAY); // the Mac ticks s1 (still has s3 ticked)
    await m.items.update(id, { title: "Renamed on the Mac" });
    await syncOnce({ db: m, fetch: server.fetch });

    await syncOnce({ db, fetch: server.fetch });
    await syncOnce({ db, fetch: server.fetch });
    await syncOnce({ db: m, fetch: server.fetch });
    for (const row of [await db.items.get(id), await m.items.get(id)]) {
      expect(done(row)).toEqual(["s1"]);
      expect(row!.title).toBe("Renamed on the Mac");
      expect(row!.sessions![3].title).toBeUndefined();
    }
  });

  it("a tick the server already accepted is forgotten: a later untick on the other device stays", async () => {
    const { server, m, id } = await setUp();
    await setSessionDone(id, "s1", true, TODAY);
    await syncOnce({ db, fetch: server.fetch }); // accepted
    await syncOnce({ db: m, fetch: server.fetch });
    clock += 60_000;
    await macSets(m, id, "s1", undefined); // the Mac unticks it on purpose
    await syncOnce({ db: m, fetch: server.fetch });
    await syncOnce({ db, fetch: server.fetch });
    expect(done(await db.items.get(id))).toEqual([]);
  });

  it("the merged ticks finish the project: done everywhere once its last session is ticked", async () => {
    const { server, m, id } = await setUp();
    for (const s of ["s1", "s2"]) await setSessionDone(id, s, true, TODAY);
    await syncOnce({ db, fetch: server.fetch });
    await syncOnce({ db: m, fetch: server.fetch });
    clock += 60_000;
    await setSessionDone(id, "s3", true, TODAY); // the phone, offline
    clock += 60_000;
    await macSets(m, id, "s4", TODAY); // the Mac, later: still open there (s3 not ticked)
    await syncOnce({ db: m, fetch: server.fetch });
    await syncOnce({ db, fetch: server.fetch });
    const row = (await db.items.get(id))!;
    expect(done(row)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(row.status).toBe("done");
  });
});
