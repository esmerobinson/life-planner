import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import { readLearned, readSharePrivate, saveLearned, saveSharePrivate, shareId } from "../data/repo";
import { journalId } from "../data/validate";
import type { JournalRow } from "../domain/types";
import { journalAad, openJson, sealJson, type JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { togetherId } from "../together/ids";
import { clock, journalDay, send, signedIn } from "../together/testKit";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// Testing session (Together link, journal side), 2026-11-05. The Mac is the app's own database
// (the repo writes to it); the phone is a second database whose rows are sealed exactly as the
// repo seals them. Both work offline, then sync. Nothing either wrote may be lost, and after
// sync both must agree. Made-up words, a fake sync server and a fake Together only.

const TOKEN = "7e57".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const DAY = "2026-11-04";
const MAC = "device-pretend-mac-01"; // = testKit's DEVICE
const PHONE = "device-pretend-phone-1";
let t = 1_800_000_000_000;
let n = 0;
const open: HubDB[] = [];
let jk: JournalKey;

beforeAll(async () => {
  jk = await keyFor("fake-journal-together"); // the key testKit's journalDay uses
});
beforeEach(async () => {
  t = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => (t += 1000));
  await Promise.all([db.items.clear(), db.goals.clear(), db.files.clear(), db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear()]);
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  await confirmedDevice(db, jk);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function phoneDevice() {
  const d = new HubDB(`together-journal-phone-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

/** A row sealed as the repo seals it. */
async function sealed(kind: JournalRow["kind"], suffix: string, entry: unknown): Promise<JournalRow> {
  const id = journalId(kind, DAY, suffix);
  return { id, kind, date: DAY, fp: jk.fp, ...(await sealJson(jk.key, entry, journalAad(id))) };
}
const phoneTick = (phone: HubDB, part: "exercise" | "checkin", on: boolean) =>
  sealed("share", part, { v: 1, private: on, at: Date.now() }).then((r) => phone.journal.put(r));
const phoneLearned = (phone: HubDB, text: string) => sealed("learned", PHONE, { v: 1, text, at: Date.now() }).then((r) => phone.journal.put(r));

/** Both devices sync until neither has anything left to send (Mac, phone, Mac, phone). */
async function syncBoth(server: FakeSyncServer, phone: HubDB) {
  for (let i = 0; i < 2; i++) {
    expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
    expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  }
  expect(await db.pending.count()).toBe(0);
  expect(await phone.pending.count()).toBe(0);
}

/** The phone's own view of the day's ticks (as readSharePrivate opens them). */
async function phoneTicks(phone: HubDB) {
  const out: Record<string, boolean> = {};
  for (const part of ["exercise", "checkin"] as const) {
    const row = await phone.journal.get(shareId(DAY, part));
    out[part] = row ? (await openJson<{ private: boolean }>(jk.key, row, journalAad(row.id))).private : false;
  }
  return out;
}

/** The same rows, byte for byte, on both devices (iv and ct included). */
async function sameRows(phone: HubDB, kind: string) {
  const strip = (rows: JournalRow[]) => rows.map(({ updatedAt: _u, ...r }) => r).sort((a, b) => a.id.localeCompare(b.id));
  expect(strip(await phone.journal.where("kind").equals(kind).toArray())).toEqual(strip(await db.journal.where("kind").equals(kind).toArray()));
}

describe("what I learned today, written on two devices the same day", () => {
  it("both offline, then sync: neither is lost, on either device", async () => {
    const server = new FakeSyncServer(TOKEN);
    const phone = await phoneDevice();
    await saveLearned(jk, DAY, MAC, "Pretend Mac lesson: breathe out longer");
    await phoneLearned(phone, "Pretend phone lesson: a feeling is a visitor");
    await syncBoth(server, phone);
    const day = await readLearned(jk, DAY);
    expect([day.text, ...day.others.map((o) => o.text)].sort()).toEqual(["Pretend Mac lesson: breathe out longer", "Pretend phone lesson: a feeling is a visitor"]);
    await sameRows(phone, "learned");
    expect(JSON.stringify([...server.rows.values()])).not.toContain("Pretend");
  });
});

describe("the private ticks on two devices", () => {
  it("Mac ticks the exercise, the phone ticks the check-in, both offline: after sync both devices have both", async () => {
    const server = new FakeSyncServer(TOKEN);
    const phone = await phoneDevice();
    await saveSharePrivate(jk, DAY, "exercise", true);
    await phoneTick(phone, "checkin", true);
    await syncBoth(server, phone);
    expect(await readSharePrivate(jk, DAY)).toEqual({ exercise: true, checkin: true });
    expect(await phoneTicks(phone)).toEqual({ exercise: true, checkin: true });
    await sameRows(phone, "share");
  });

  it("the Mac ticks then unticks the exercise while the phone ticks the check-in: the phone's tick stays", async () => {
    const server = new FakeSyncServer(TOKEN);
    const phone = await phoneDevice();
    await saveSharePrivate(jk, DAY, "exercise", true);
    await phoneTick(phone, "checkin", true);
    await syncOnce({ db, fetch: server.fetch });
    await saveSharePrivate(jk, DAY, "exercise", false);
    await syncBoth(server, phone);
    expect(await readSharePrivate(jk, DAY)).toEqual({ exercise: false, checkin: true });
    expect(await phoneTicks(phone)).toEqual({ exercise: false, checkin: true });
  });

  for (const [first, second] of [["mac", "phone"], ["phone", "mac"]] as const) {
    it(`the same tick changed on both, offline (${first} first, ${second} later): after sync both agree on the later one`, async () => {
      const server = new FakeSyncServer(TOKEN);
      const phone = await phoneDevice();
      const later = second === "mac" ? false : true;
      for (const who of [first, second]) {
        const on = who === second ? later : !later;
        if (who === "mac") await saveSharePrivate(jk, DAY, "checkin", on);
        else await phoneTick(phone, "checkin", on);
      }
      await syncBoth(server, phone);
      expect((await readSharePrivate(jk, DAY)).checkin).toBe(later);
      expect((await phoneTicks(phone)).checkin).toBe(later);
      await sameRows(phone, "share");
    });
  }

  it("a tick on one device never loses the other device's answers or learned words that day", async () => {
    const server = new FakeSyncServer(TOKEN);
    const phone = await phoneDevice();
    await saveSharePrivate(jk, DAY, "exercise", true);
    await saveSharePrivate(jk, DAY, "checkin", true);
    await phoneLearned(phone, "Pretend phone lesson kept");
    const answer = await sealed("answer", `abcdef012345:${PHONE}`, { v: 1, text: "Pretend phone answer", at: Date.now() });
    await phone.journal.put(answer);
    await syncBoth(server, phone);
    expect((await readLearned(jk, DAY)).text).toBe("Pretend phone lesson kept");
    expect(await db.journal.get(answer.id)).toMatchObject({ ct: answer.ct });
    expect(await phoneTicks(phone)).toEqual({ exercise: true, checkin: true });
  });
});

describe("ticked on the phone after the Mac sent the day's answers to Together", () => {
  it("the exercise tick reaches the Mac by sync; its next send hides the answers and what she learned", async () => {
    const c = clock("2026-11-04T10:00:00");
    const fake = await signedIn(c);
    const server = new FakeSyncServer(TOKEN);
    const phone = await phoneDevice();
    await journalDay(DAY, { exercise: true, learned: "Pretend Wyndle learned words" });
    await syncBoth(server, phone);
    c.set("2026-11-06T03:30:00"); // the answers are due
    expect(await send(fake, c)).toMatchObject({ kind: "ok" });
    const habit = await togetherId("habit", "exercise", 1);
    expect(fake.liveTallies(habit).map((e) => e.note).join()).toContain("Pretend Wyndle learned words");

    await phoneTick(phone, "exercise", true); // on the phone, the next morning
    await syncBoth(server, phone);
    expect((await readSharePrivate(jk, DAY)).exercise).toBe(true);
    expect(await send(fake, c)).toMatchObject({ kind: "ok" });
    const live = fake.liveTallies(habit).map((e) => String(e.note));
    expect(live).toHaveLength(1);
    expect(live[0]).not.toMatch(/Pretend exercise answer|Wyndle|What I learned today/);
  });
});
