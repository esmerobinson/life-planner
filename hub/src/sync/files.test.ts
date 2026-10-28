import Dexie from "dexie";
import { vi } from "vitest";
import { HubDB } from "../data/db";
import { pictureLine } from "../domain/page";
import type { FileRow, Item } from "../domain/types";
import { FakeSyncServer } from "./fakeServer";
import { MAX_REQUEST_BYTES, saveSyncSettings, syncOnce } from "./engine";

// Pictures (the `files` table, round 3b) sync like items and goals, through the fake server
// that follows the real one's contract.

const TOKEN = "f11e".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
let clock = 1_800_000_000_000;
let n = 0;
const open: HubDB[] = [];

beforeEach(() => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function device(name: string) {
  const d = new HubDB(`files-${name}-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

/** Base64 of about `bytes` image bytes (made-up content of a valid shape). */
const base64Of = (bytes: number) => "A".repeat(Math.ceil(bytes / 3) * 4);
const picture = (id: string, data = "/9j/4AAQ"): FileRow => ({
  id, mime: "image/jpeg", data, width: 1600, height: 1200, createdAt: "2026-10-28",
});
const task = (id: string, notes: string): Item => ({
  id, kind: "task", title: "Pretend task", notes, links: [], areaId: "art", priority: 2,
  status: "open", createdAt: "2026-10-28", touchedAt: "2026-10-28",
});

describe("pictures sync", () => {
  it("a picture and the page that shows it travel from the Mac to the phone", async () => {
    const server = new FakeSyncServer(TOKEN);
    const mac = await device("mac");
    const phone = await device("phone");
    await mac.files.add(picture("p1"));
    await mac.items.add(task("t1", `Look:\n${pictureLine("p1")}`));
    expect(await syncOnce({ db: mac, fetch: server.fetch })).toMatchObject({ kind: "ok", sent: 2 });
    expect(server.data("files", "p1")).toMatchObject({ id: "p1", mime: "image/jpeg", width: 1600 });

    expect(await syncOnce({ db: phone, fetch: server.fetch })).toMatchObject({ kind: "ok", received: 2 });
    expect(await phone.files.get("p1")).toMatchObject({ data: "/9j/4AAQ", width: 1600, height: 1200 });
    expect((await phone.items.get("t1"))!.notes).toBe(`Look:\n${pictureLine("p1")}`);
    expect(await phone.pending.count()).toBe(0); // applied rows are not sent back
  });

  it("several big pictures (just under 700 KB each) go one per request and all arrive", async () => {
    const server = new FakeSyncServer(TOKEN);
    const mac = await device("mac");
    const phone = await device("phone");
    const big = base64Of(699_000);
    await mac.files.bulkAdd([picture("b1", big), picture("b2", big), picture("b3", big)]);
    const sizes: number[] = [];
    const counting: typeof fetch = async (input, init) => {
      sizes.push(new TextEncoder().encode(String(init?.body ?? "")).length);
      return server.fetch(input, init);
    };
    expect(await syncOnce({ db: mac, fetch: counting })).toMatchObject({ kind: "ok", sent: 3, held: 0 });
    expect(sizes.every((s) => s <= MAX_REQUEST_BYTES)).toBe(true);
    expect(sizes.filter((s) => s > 900_000)).toHaveLength(3);

    expect(await syncOnce({ db: phone, fetch: server.fetch })).toMatchObject({ kind: "ok", received: 3 });
    for (const id of ["b1", "b2", "b3"]) expect((await phone.files.get(id))!.data).toBe(big);
  });

  it("a picture row this version cannot read waits in quarantine instead of being lost", async () => {
    const server = new FakeSyncServer(TOKEN);
    await server.fetch(`${SERVER}/v1/sync`, {
      method: "POST", headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        deviceId: "newer-device-1", cursor: 0,
        changes: [{ table: "files", id: "heic", updatedAt: 10, data: { ...picture("heic"), mime: "image/heic", updatedAt: 10 } }],
      }),
    });
    const phone = await device("phone");
    expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
    expect(await phone.files.get("heic")).toBeUndefined();
    expect(await phone.quarantine.get(["files", "heic"])).toMatchObject({ table: "files", id: "heic", updatedAt: 10 });
  });

  it("a purged picture (its page emptied from the Bin) replaces the picture on the other device", async () => {
    const server = new FakeSyncServer(TOKEN);
    const mac = await device("mac");
    const phone = await device("phone");
    await mac.files.add(picture("p1"));
    await syncOnce({ db: mac, fetch: server.fetch });
    await syncOnce({ db: phone, fetch: server.fetch });
    clock += 60_000;
    await mac.files.put({ ...picture("p1"), data: "", width: 0, height: 0, status: "purged" });
    await syncOnce({ db: mac, fetch: server.fetch });
    await syncOnce({ db: phone, fetch: server.fetch });
    expect(await phone.files.get("p1")).toMatchObject({ data: "", status: "purged" });
  });
});
