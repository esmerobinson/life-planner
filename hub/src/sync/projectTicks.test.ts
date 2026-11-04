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

  // R-4: if putting the notes on would make an unreadable row, the notes go and the incoming row wins as it is.
  it("notes that would make an invalid row are dropped, and the incoming row is applied as it is", async () => {
    const { server, m, id } = await setUp();
    clock += 60_000;
    await setSessionDone(id, "s1", true, TODAY); // the phone, offline
    await db.syncMeta.put({ key: `sessionTicks:${id}`, value: { s1: { doneOn: "not-a-date", at: clock } } }); // a damaged note
    clock += 60_000;
    await macSets(m, id, "s2", TODAY);
    await syncOnce({ db: m, fetch: server.fetch });

    await syncOnce({ db, fetch: server.fetch });
    expect(done(await db.items.get(id))).toEqual(["s2"]); // the Mac's row, untouched
    expect(await db.syncMeta.get(`sessionTicks:${id}`)).toBeUndefined(); // the notes are gone
    expect(await db.pending.count()).toBe(0); // nothing odd is sent
    expect(await db.quarantine.count()).toBe(0);
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

  // R-1: a delete, archive or change of type on the other device wins over a carried tick.
  for (const [what, change] of [
    ["binned", (r: Item): Item => ({ ...r, status: "deleted", deletedAt: TODAY })],
    ["archived", (r: Item): Item => ({ ...r, status: "archived" })],
    // Change to → Goal archives the to-do (with its sessions) and makes a goal.
    ["changed into a goal", (r: Item): Item => ({ ...r, status: "archived", notes: "Became a goal: Pretend street scene" })],
    ["changed into an idea", (r: Item): Item => ({ ...r, kind: "idea" })],
  ] as const) {
    it(`a project ${what} on the other device stays that way; the phone's tick note is dropped`, async () => {
      const { server, m, id } = await setUp();
      clock += 60_000;
      await setSessionDone(id, "s1", true, TODAY); // the phone, offline: a note
      clock += 60_000;
      const row = (await m.items.get(id))!;
      await m.items.put(change(row));
      if (what === "changed into a goal") {
        await m.goals.put({ id: "g", title: "Pretend street scene", areaId: "art", kind: "practice", milestones: [], createdAt: TODAY });
      }
      await syncOnce({ db: m, fetch: server.fetch });
      await syncOnce({ db, fetch: server.fetch });
      await syncOnce({ db, fetch: server.fetch });
      await syncOnce({ db: m, fetch: server.fetch });
      const want = change(row);
      for (const r of [await db.items.get(id), await m.items.get(id), server.data("items", id) as unknown as Item]) {
        expect(r).toMatchObject({ status: want.status, kind: want.kind });
        expect(done(r)).toEqual([]); // the Mac's row as it was: no tick carried onto it
      }
      expect(await db.syncMeta.get(`sessionTicks:${id}`)).toBeUndefined();
      expect(await db.pending.count()).toBe(0);
    });
  }

  it("a far-future clock re-stamp keeps the notes forgettable (R-2)", async () => {
    const { server, m, id } = await setUp();
    clock += 60_000;
    const realNow = clock;
    clock += 48 * 3_600_000; // the phone's clock runs two days fast
    await setSessionDone(id, "s1", true, TODAY);
    clock = realNow; // back to the right time: the server refuses the far-future stamp, the engine re-stamps it
    await syncOnce({ db, fetch: server.fetch });
    expect(done(server.data("items", id) as unknown as Item)).toEqual(["s1"]);
    expect(await db.syncMeta.get(`sessionTicks:${id}`)).toBeUndefined(); // accepted after the re-stamp: forgotten
    clock += 60_000;
    await syncOnce({ db: m, fetch: server.fetch });
    await macSets(m, id, "s1", undefined); // a deliberate untick on the Mac
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
