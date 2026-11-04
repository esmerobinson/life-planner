import Dexie from "dexie";
import { HubDB } from "../data/db";
import { outfitRow, placedRow, seenRow, startRow } from "../farm/state";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// Esme's Farm's own table (farm/state.ts) syncs like every table: tracked local writes,
// last write wins, invalid rows never stored or sent; and an app version from before the
// farm keeps the rows safely (quarantine) and applies them once it updates.

const TOKEN = "f0f0".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
let n = 0;
const open: HubDB[] = [];
afterEach(async () => {
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function device() {
  const d = new HubDB(`farm-sync-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

it("an existing v5 database upgrades with its rows kept and an empty farm table", async () => {
  const name = `farm-upgrade-${++n}`;
  const old = new Dexie(name);
  old.version(1).stores({ items: "id, status, areaId, goalId, due", goals: "id" });
  old.version(2).stores({ syncMeta: "key", pending: "[table+id]" });
  old.version(3).stores({ quarantine: "[table+id]" });
  old.version(4).stores({ files: "id" });
  old.version(5).stores({ journal: "id, kind, date" });
  await old.open();
  await old.table("journal").put({ id: "page:2026-11-01:x", kind: "page", date: "2026-11-01", iv: "AAAA", ct: "AAAA", updatedAt: 5 });
  old.close();
  const now = new HubDB(name);
  open.push(now);
  await now.open();
  expect(now.verno).toBeGreaterThanOrEqual(6);
  expect(await now.journal.count()).toBe(1);
  expect(await now.farm.count()).toBe(0);
  expect(await now.pending.count()).toBe(0); // nothing re-sent
});

it("a local farm write is stamped and marked pending", async () => {
  const mac = await device();
  await mac.farm.put(seenRow("hi", "2026-11-04"));
  const row = await mac.farm.get("seen:hi");
  expect(row?.updatedAt).toBeGreaterThan(0);
  expect(await mac.pending.get(["farm", "seen:hi"])).toBeTruthy();
});

it("an invalid farm row is never stored", async () => {
  const mac = await device();
  await expect(mac.farm.put({ id: "seen:hi", kind: "seen", sticker: "door", date: "2026-11-04" } as never)).rejects.toThrow(
    /farm change could not be saved/,
  );
  expect(await mac.farm.count()).toBe(0);
});

it("farm rows go from one device to another", async () => {
  const server = new FakeSyncServer(TOKEN);
  const mac = await device();
  const phone = await device();
  await mac.farm.bulkPut([startRow("mac-device", "2026-11-04"), seenRow("hi", "2026-11-04"), placedRow("hi", "hi", "2026-11-04")]);
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  expect((await phone.farm.toArray()).map((r) => r.id).sort()).toEqual(["placed:hi", "seen:hi", "start:mac-device"]);
});

it("the later outfit choice wins on both devices", async () => {
  const server = new FakeSyncServer(TOKEN);
  const mac = await device();
  const phone = await device();
  await mac.farm.put(outfitRow("bap", "A1"));
  await syncOnce({ db: mac, fetch: server.fetch });
  await syncOnce({ db: phone, fetch: server.fetch });
  await phone.farm.put(outfitRow("bap", "H4"));
  await syncOnce({ db: phone, fetch: server.fetch });
  await syncOnce({ db: mac, fetch: server.fetch });
  expect((await mac.farm.get("outfit:bap"))).toMatchObject({ item: "H4" });
});

describe("before the server knows the farm table (review I1)", () => {
  const pretendTask = (id: string) => ({
    id, kind: "task" as const, title: "Pretend", links: [], areaId: "art" as const, priority: 2 as const, status: "open" as const,
    createdAt: "2026-11-04", touchedAt: "2026-11-04",
  });

  it("one probe, then the farm rows wait (held, not stuck) and every other row syncs; once the server takes the table, they go", async () => {
    // A Worker without "farm" in TABLES answers 400 bad_change for any farm change.
    let knowsFarm = false;
    const server = new FakeSyncServer(TOKEN, { reject: (c) => (c.table === "farm" && !knowsFarm ? "bad_change" : undefined) });
    let requests = 0;
    const counted: typeof fetch = (input, init) => {
      requests++;
      return server.fetch(input as string, init as RequestInit);
    };
    const mac = await device();
    // 150 farm rows (more than a week of stickers) and two to-dos, all pending at once.
    await mac.farm.bulkPut(Array.from({ length: 150 }, (_, i) => seenRow(`pretend-${i}`, "2026-11-04")));
    await mac.items.bulkAdd([pretendTask("a"), pretendTask("b")]);

    const first = await syncOnce({ db: mac, fetch: counted });
    expect(first.kind).toBe("ok");
    expect(server.data("items", "a")).toBeTruthy();
    expect(server.data("items", "b")).toBeTruthy();
    expect(requests).toBeLessThanOrEqual(3); // the probe and the batch, never row by row
    expect(await mac.pending.where("table").equals("farm").count()).toBe(150);
    expect(await mac.pending.filter((p) => p.stuck === true).count()).toBe(0);

    // Next run: one probe again, still nothing stuck.
    requests = 0;
    expect((await syncOnce({ db: mac, fetch: counted })).kind).toBe("ok");
    expect(requests).toBeLessThanOrEqual(2);

    // The Worker is deployed: the next run's probe goes through and so does everything else.
    knowsFarm = true;
    expect((await syncOnce({ db: mac, fetch: counted })).kind).toBe("ok");
    expect(await mac.pending.count()).toBe(0);
    expect(server.data("farm", "seen:pretend-149")).toBeTruthy();
  });

  it("once the server has taken the table, a single bad farm row is just that row (stuck), not the table", async () => {
    let refuse = "";
    const server = new FakeSyncServer(TOKEN, { reject: (c) => (c.table === "farm" && c.id === refuse ? "bad_change" : undefined) });
    const mac = await device();
    await mac.farm.put(seenRow("hi", "2026-11-04"));
    await syncOnce({ db: mac, fetch: server.fetch }); // accepted: the table is known now
    refuse = "seen:door";
    await mac.farm.bulkPut([seenRow("door", "2026-11-05"), seenRow("steps", "2026-11-05")]);
    await syncOnce({ db: mac, fetch: server.fetch });
    expect(server.data("farm", "seen:steps")).toBeTruthy();
    expect(await mac.pending.get(["farm", "seen:door"])).toMatchObject({ stuck: true });
  });
});

it("farm rows an older version kept in quarantine apply once this version runs", async () => {
  // An app version from before the farm skips the table and keeps its rows in quarantine
  // (unknownTables.test.ts); after updating, the next sync applies them.
  const server = new FakeSyncServer(TOKEN);
  const phone = await device();
  const row = { ...seenRow("hi", "2026-11-04"), updatedAt: 7 };
  await phone.quarantine.put({ table: "farm", id: row.id, updatedAt: 7, data: row, reason: "unknown table", cursor: 0 });
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  expect(await phone.farm.get("seen:hi")).toMatchObject({ sticker: "hi", updatedAt: 7 });
  expect(await phone.quarantine.count()).toBe(0);
});

it("a farm row this version can't read waits in quarantine (a later pack's kind)", async () => {
  const server = new FakeSyncServer(TOKEN);
  await server.fetch(`${SERVER}/v1/sync`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      deviceId: "newer-device-1", cursor: 0,
      changes: [{ table: "farm", id: "coins:all", updatedAt: 10, data: { id: "coins:all", kind: "coins", n: 3, updatedAt: 10 } }],
    }),
  });
  const phone = await device();
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  expect(await phone.farm.count()).toBe(0);
  expect(await phone.quarantine.get(["farm", "coins:all"])).toBeTruthy();
});
