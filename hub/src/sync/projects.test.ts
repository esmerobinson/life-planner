import Dexie from "dexie";
import { vi } from "vitest";
import { HubDB } from "../data/db";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// Project to-dos through sync (fix round 1). Pretend data only.

const TOKEN = "beef".padEnd(64, "0"); // fake
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
  const d = new HubDB(`projects-sync-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

const wire = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({
  table: "items", id, updatedAt,
  data: { id, updatedAt, kind: "task", title: "Pretend street scene", links: [], areaId: "art", priority: 2, status: "open",
    createdAt: "2026-10-29", touchedAt: "2026-10-29", ...extra },
});

async function serverWith(changes: ReturnType<typeof wire>[]) {
  const server = new FakeSyncServer(TOKEN);
  await server.fetch(`${SERVER}/v1/sync`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ deviceId: "older-device-1", cursor: 0, changes }),
  });
  return server;
}

describe("rows an older app version writes for projects (I-3)", () => {
  it("an idea that kept its sessions applies cleanly: no quarantine, no notice", async () => {
    const sessions = [{ id: "a", title: "Block out the street", doneOn: "2026-10-30" }, { id: "b" }];
    const server = await serverWith([wire("p", 10, { kind: "idea", sessions })]);
    const d = await device();
    expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("ok");
    expect(await d.items.get("p")).toMatchObject({ kind: "idea", sessions });
    expect(await d.quarantine.count()).toBe(0);
  });

  it("a habit with sessions, and a done project with open sessions, apply cleanly too", async () => {
    const server = await serverWith([
      wire("h", 10, { recur: ["mon"], sessions: [{ id: "a" }] }),
      wire("d", 11, { status: "done", completedAt: "2026-11-01", sessions: [{ id: "a" }, { id: "b" }] }),
    ]);
    const d = await device();
    await syncOnce({ db: d, fetch: server.fetch });
    expect(await d.items.get("h")).toBeTruthy();
    expect(await d.items.get("d")).toMatchObject({ status: "done" });
    expect(await d.quarantine.count()).toBe(0);
  });
});
