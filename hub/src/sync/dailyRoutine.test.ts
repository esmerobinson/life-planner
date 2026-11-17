import Dexie from "dexie";
import { HubDB } from "../data/db";
import { routineDay, routineSteps, stepRowId, tickRowId, type RoutineStepRow, type RoutineTickRow } from "../domain/dailyRoutine";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// Today's routine syncs through the `prefs` table: one row per step and one per step per day, so
// two devices changing different steps (or ticking different steps) between syncs both keep
// their change. All data is fictional.

const TOKEN = "f0f0".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const TODAY = "2026-11-17";
let n = 0;
const open: HubDB[] = [];
afterEach(async () => {
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function device() {
  const d = new HubDB(`routine-sync-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

const tick = (stepId: string, done = true): RoutineTickRow => ({ id: tickRowId(TODAY, stepId), date: TODAY, step: stepId, done });

async function day(d: HubDB) {
  const rows = await d.prefs.toArray();
  const steps = routineSteps(rows.filter((r) => r.id.startsWith("routine-step:")) as RoutineStepRow[]);
  return routineDay(steps, await d.items.toArray(), rows.filter((r) => r.id.startsWith("routine-tick:")) as RoutineTickRow[], TODAY);
}

describe("Today's routine across two devices", () => {
  it("a tick on one device shows on the other", async () => {
    const server = new FakeSyncServer(TOKEN);
    const mac = await device();
    const phone = await device();
    await phone.prefs.put(tick("d2"));
    expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
    expect(server.data("prefs", tickRowId(TODAY, "d2"))).toMatchObject({ done: true, step: "d2" });
    expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
    expect((await day(mac)).rows.find((r) => r.step.id === "d2")!.done).toBe(true);
  });

  it("different steps ticked and edited on each device between syncs: nothing is lost", async () => {
    const server = new FakeSyncServer(TOKEN);
    const mac = await device();
    const phone = await device();
    await mac.prefs.bulkPut([tick("d1"), { id: stepRowId("d2"), title: "Sit quietly (pretend)" }]);
    await phone.prefs.bulkPut([tick("d3"), { id: stepRowId("d4"), habitId: null }, { id: stepRowId("d5"), removed: true }]);
    for (const d of [mac, phone, mac]) expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("ok");
    for (const d of [mac, phone]) {
      const v = await day(d);
      expect(v.rows.filter((r) => r.done).map((r) => r.step.id)).toEqual(["d1", "d3"]);
      expect(v.rows.find((r) => r.step.id === "d2")!.step.title).toBe("Sit quietly (pretend)");
      expect(v.rows.find((r) => r.step.id === "d4")!.step.habitId).toBeNull();
      expect(v.rows.map((r) => r.step.id)).not.toContain("d5");
    }
  });

  it("the same step on both devices: the later change wins on both, as every row does", async () => {
    const server = new FakeSyncServer(TOKEN);
    const mac = await device();
    const phone = await device();
    await mac.prefs.put(tick("d6", true));
    await new Promise((r) => setTimeout(r, 5));
    await phone.prefs.put(tick("d6", false));
    for (const d of [mac, phone, mac]) expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("ok");
    for (const d of [mac, phone]) expect((await day(d)).rows.find((r) => r.step.id === "d6")!.done).toBe(false);
  });

  it("a malformed routine row is never stored", async () => {
    const mac = await device();
    await expect(mac.prefs.put({ ...tick("d1"), done: "yes" } as never)).rejects.toThrow(/could not be saved/);
  });
});
