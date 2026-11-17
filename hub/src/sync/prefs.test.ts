import Dexie from "dexie";
import { HubDB } from "../data/db";
import { DEFAULT_DUE_PREFS, duePrefsRow, normalizeDuePrefs, validPrefs } from "../reminders/duePrefs";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// The Due reminder settings row (prefs table) syncs like every table, in plain JSON (the sync
// Worker reads it); a server not yet updated holds it back without stopping other rows; an
// app version from before the table keeps it in quarantine.

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
  const d = new HubDB(`prefs-sync-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

const on = () => duePrefsRow({ ...DEFAULT_DUE_PREFS, on: true, lines: ["Pretend line"] });

describe("the Due settings row", () => {
  it("is checked: known fields well formed, unknown fields allowed, other ids for later", () => {
    expect(validPrefs(on())).toBe(true);
    expect(validPrefs({ id: "due" })).toBe(true);
    expect(validPrefs({ ...on(), laterField: 1 })).toBe(true);
    for (const bad of [{ on: "yes" }, { timeZone: "Mars/Base" }, { plan: "9am" }, { leadMinutes: 241 }, { lines: [""] }, { lines: ["x".repeat(121)] }, { lines: Array(51).fill("x") }]) {
      expect(validPrefs({ ...on(), ...bad })).toBe(false);
    }
    expect(validPrefs({ ...on(), id: "other" })).toBe(false);
  });

  it("is made whole when read (defaults; off unless on is true)", () => {
    expect(normalizeDuePrefs(undefined)).toEqual(DEFAULT_DUE_PREFS);
    expect(normalizeDuePrefs({ on: "true", plan: "8:00", lines: ["ok", 3] })).toEqual({ ...DEFAULT_DUE_PREFS, lines: ["ok"] });
  });

  it("goes to the server as plain JSON and to her other devices", async () => {
    const server = new FakeSyncServer(TOKEN);
    const mac = await device();
    const phone = await device();
    await mac.prefs.put(on());
    expect(await mac.pending.get(["prefs", "due"])).toBeTruthy();
    expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
    expect(server.data("prefs", "due")).toMatchObject({ on: true, lines: ["Pretend line"], timeZone: "America/New_York" });
    expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
    expect(await phone.prefs.get("due")).toMatchObject({ on: true, lines: ["Pretend line"] });
  });

  it("an invalid row is never stored", async () => {
    const mac = await device();
    await expect(mac.prefs.put({ ...on(), plan: "nine" } as never)).rejects.toThrow(/setting could not be saved/);
  });

  it("before the Worker knows the table: held (one probe), everything else syncs; then it goes", async () => {
    let knows = false;
    const server = new FakeSyncServer(TOKEN, { reject: (c) => (c.table === "prefs" && !knows ? "bad_change" : undefined) });
    const mac = await device();
    await mac.prefs.put(on());
    await mac.items.add({
      id: "a", kind: "task", title: "Pretend", links: [], areaId: "art", priority: 2, status: "open", createdAt: "2026-11-16", touchedAt: "2026-11-16",
    });
    expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
    expect(server.data("items", "a")).toBeTruthy();
    expect(await mac.pending.get(["prefs", "due"])).toMatchObject({ table: "prefs" });
    expect(await mac.pending.filter((p) => p.stuck === true).count()).toBe(0);
    knows = true;
    expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
    expect(server.data("prefs", "due")).toBeTruthy();
  });

  it("an app version from before the table keeps the row in quarantine and applies it after updating", async () => {
    const server = new FakeSyncServer(TOKEN);
    const phone = await device();
    const row = { ...on(), updatedAt: 7 };
    await phone.quarantine.put({ table: "prefs", id: "due", updatedAt: 7, data: row as never, reason: "unknown table", cursor: 0 });
    expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
    expect(await phone.prefs.get("due")).toMatchObject({ on: true, updatedAt: 7 });
  });
});
