import Dexie from "dexie";
import { HubDB } from "../data/db";
import type { Item } from "../domain/types";
import { FakeSyncServer } from "./fakeServer";
import { getMeta, saveSyncSettings, syncOnce } from "./engine";

// A later app version may add a synced table this build does not know (as 3b added
// "files"). Its rows must never stop this device syncing: they are skipped, the cursor still
// moves on, other rows apply and this device's own changes still go (review I1).

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
  const d = new HubDB(`unknown-tables-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

const task = (id: string, updatedAt: number): Item => ({
  id, kind: "task", title: `Pretend ${id}`, links: [], areaId: "art", priority: 2, status: "open",
  createdAt: "2026-10-28", touchedAt: "2026-10-28", updatedAt,
});

it("rows of a table this build does not know are skipped; sync keeps working", async () => {
  const server = new FakeSyncServer(TOKEN, { extraTables: ["future"] });
  await server.fetch(`${SERVER}/v1/sync`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      deviceId: "newer-device-1", cursor: 0,
      changes: [
        { table: "future", id: "j1", updatedAt: 10, data: { id: "j1", updatedAt: 10, words: "pretend" } },
        { table: "items", id: "a", updatedAt: 11, data: task("a", 11) },
      ],
    }),
  });
  const phone = await device();
  await phone.items.add(task("mine", 1));

  const first = await syncOnce({ db: phone, fetch: server.fetch });
  expect(first.kind).toBe("ok");
  expect(await phone.items.get("a")).toBeTruthy(); // other rows apply
  expect(server.data("items", "mine")).toBeTruthy(); // pushes still go
  expect(await getMeta(phone, "cursor")).toBe(server.seq); // the cursor moves past the unknown row
  // Kept (counted on the Sync page) for when this app updates, never applied as a row here.
  expect(await phone.quarantine.get(["future", "j1"])).toMatchObject({ table: "future", id: "j1", updatedAt: 10 });
  expect(await phone.pending.count()).toBe(0);

  // And it keeps working afterwards.
  await phone.items.update("mine", { title: "Pretend edited" });
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  expect(server.data("items", "mine")).toMatchObject({ title: "Pretend edited" });
});

it("an unknown table left in quarantine (by any build) is skipped, not fatal", async () => {
  const server = new FakeSyncServer(TOKEN);
  const phone = await device();
  await phone.quarantine.put({
    table: "future" as never, id: "j1", updatedAt: 5, data: { id: "j1" }, reason: "pretend", cursor: 0,
  });
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  expect(await phone.quarantine.count()).toBe(1); // kept for a later version
});
