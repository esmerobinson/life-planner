import Dexie from "dexie";
import { vi } from "vitest";
import { HubDB } from "../data/db";
import type { FileRow, Item } from "../domain/types";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// Photos on "What I did" notes sync like a page's pictures: the to-do carries the ids, the
// files table the image. Made-up rows only, through the fake server.

const TOKEN = "d1d0".padEnd(64, "0"); // fake
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
  const d = new HubDB(`did-photos-${name}-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

const picture = (id: string): FileRow => ({ id, mime: "image/jpeg", data: "/9j/4AAQ", width: 1600, height: 1200, createdAt: "2026-11-18" });
const todo = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: "Pretend to-do", links: [], areaId: "art", priority: 2, status: "done",
  completedAt: "2026-11-18", createdAt: "2026-11-18", touchedAt: "2026-11-18", ...extra,
});
const withPhoto = (id: string, photo: string) =>
  todo(id, { did: [{ id: "note", on: "2026-11-18" }], didPhotos: [{ entry: "note", ids: [photo] }] });

it("a note's photo and its to-do travel from the phone to the Mac", async () => {
  const server = new FakeSyncServer(TOKEN);
  const phone = await device("phone");
  const mac = await device("mac");
  await phone.files.add(picture("p1"));
  await phone.items.add(withPhoto("t1", "p1"));
  await syncOnce({ db: phone, fetch: server.fetch });
  await syncOnce({ db: mac, fetch: server.fetch });
  expect((await mac.items.get("t1"))!.didPhotos).toEqual([{ entry: "note", ids: ["p1"] }]);
  expect((await mac.files.get("p1"))!.data).toBe("/9j/4AAQ");
});

it("an emptied picture a note on this device still shows is kept and sent back", async () => {
  const server = new FakeSyncServer(TOKEN);
  const mac = await device("mac");
  const phone = await device("phone");
  await mac.files.add(picture("p2"));
  await syncOnce({ db: mac, fetch: server.fetch });
  await syncOnce({ db: phone, fetch: server.fetch });
  clock += 60_000;
  await phone.items.add(withPhoto("t2", "p2"));
  clock += 60_000;
  await mac.files.put({ ...picture("p2"), data: "", width: 0, height: 0, status: "purged" });
  await syncOnce({ db: mac, fetch: server.fetch });
  await syncOnce({ db: phone, fetch: server.fetch });
  expect((await phone.files.get("p2"))!.data).toBe("/9j/4AAQ");
  expect(server.data("files", "p2")).toMatchObject({ data: "/9j/4AAQ" });
});
