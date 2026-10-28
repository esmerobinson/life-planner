import Dexie from "dexie";
import { vi } from "vitest";
import { HubDB } from "../data/db";
import type { Item } from "../domain/types";
import { FakeSyncServer } from "./fakeServer";
import { getMeta, saveSyncSettings, syncOnce } from "./engine";

// "An app update": a later build accepts the area "garden"; this build does not yet.
const update = vi.hoisted(() => ({ knowsGarden: false }));
vi.mock("../data/validate", async (importOriginal) => {
  const real = await importOriginal<typeof import("../data/validate")>();
  return {
    ...real,
    validItem: (r: unknown): r is Item =>
      real.validItem(r) ||
      (update.knowsGarden && (r as { areaId?: string }).areaId === "garden" && real.validItem({ ...(r as object), areaId: "art" })),
  };
});

const TOKEN = "abcd".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
let n = 0;
const open: HubDB[] = [];
afterEach(async () => {
  update.knowsGarden = false;
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function device() {
  const d = new HubDB(`quarantine-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

const wire = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({
  table: "items", id, updatedAt,
  data: { id, updatedAt, kind: "task", title: id, links: [], areaId: "art", priority: 2, status: "open",
    createdAt: "2026-10-01", touchedAt: "2026-10-01", ...extra },
});

/** A server that already holds rows written by a newer app version on another device. */
async function serverWith(changes: ReturnType<typeof wire>[]) {
  const server = new FakeSyncServer(TOKEN);
  await server.fetch(`${SERVER}/v1/sync`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ deviceId: "newer-device-1", cursor: 0, changes }),
  });
  return server;
}

describe("rows this app version cannot read yet", () => {
  it("are kept in quarantine (not stored, not lost) while the cursor moves on", async () => {
    const server = await serverWith([wire("ok", 10), wire("future", 11, { areaId: "garden" })]);
    const a = await device();
    expect((await syncOnce({ db: a, fetch: server.fetch })).kind).toBe("ok");
    expect(await a.items.get("ok")).toBeTruthy();
    expect(await a.items.get("future")).toBeUndefined();
    const q = await a.quarantine.toArray();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ table: "items", id: "future", updatedAt: 11 });
    expect((q[0]!.data as { areaId: string }).areaId).toBe("garden");
    expect(q[0]!.reason).toBeTruthy();
    expect(await getMeta(a, "cursor")).toBe(server.seq);
  });

  it("are applied on a later sync once the app can read them (after an update)", async () => {
    const server = await serverWith([wire("future", 11, { areaId: "garden" })]);
    const a = await device();
    await syncOnce({ db: a, fetch: server.fetch });
    expect(await a.quarantine.count()).toBe(1);
    update.knowsGarden = true;
    await syncOnce({ db: a, fetch: server.fetch });
    expect((await a.items.get("future"))!.areaId).toBe("garden");
    expect(await a.quarantine.count()).toBe(0);
    expect(await a.pending.count()).toBe(0); // applied as a server row, not sent back
  });

  it("a quarantined row never replaces a newer local version when it is finally applied", async () => {
    const server = await serverWith([wire("x", 11, { areaId: "garden" })]);
    const a = await device();
    await syncOnce({ db: a, fetch: server.fetch });
    await a.items.add({ ...(wire("x", 0).data as unknown as Item), title: "made here later" }); // stamped now
    update.knowsGarden = true;
    await syncOnce({ db: a, fetch: server.fetch });
    expect((await a.items.get("x"))!.title).toBe("made here later");
    expect(await a.quarantine.count()).toBe(0);
  });

  it("a readable newer version of the row clears its quarantine", async () => {
    const server = await serverWith([wire("x", 11, { areaId: "garden" })]);
    const a = await device();
    await syncOnce({ db: a, fetch: server.fetch });
    await server.fetch(`${SERVER}/v1/sync`, {
      method: "POST", headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ deviceId: "newer-device-1", cursor: 0, changes: [wire("x", 20, { title: "readable now" })] }),
    });
    await syncOnce({ db: a, fetch: server.fetch });
    expect((await a.items.get("x"))!.title).toBe("readable now");
    expect(await a.quarantine.count()).toBe(0);
  });
});
