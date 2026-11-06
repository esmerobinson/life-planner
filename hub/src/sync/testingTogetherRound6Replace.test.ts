// TESTING (Life Planner - Together-link Round 6 Testing, 2026-11-06): round 6's #58, after a
// backup Replace and before sync has pulled everything again. The Mac is the app's own database
// (signed in to Together); the phone is a second database whose rows are sealed as the repo
// seals them. Fake sync server and fake Together only; every word made up. Tests named "BUG:"
// fail on together-link @e473622.

import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import { exportBackup, restoreBackup } from "../data/backup";
import { createHighlight, listHighlights, openNoteSession, readLearned, readSharePrivate, saveHighlightNote, saveLearned, saveSharePrivate } from "../data/repo";
import { journalId } from "../data/validate";
import type { JournalRow } from "../domain/types";
import { journalAad, sealJson, type JournalKey } from "../journal/crypto";
import { describeAnchor } from "../journal/highlights";
import { confirmedDevice, keyFor } from "../test/journalKey";
import type { FakeSupabase } from "../together/fakeSupabase";
import { togetherId } from "../together/ids";
import { readSent } from "../together/store";
import { clock, DEVICE, journalDay, send, signedIn, type Clock } from "../together/testKit";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, stopSyncing, syncOnce } from "./engine";

const TOKEN = "6e66".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const D = "2026-11-04";
const D0 = "2026-11-03";
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
  const d = new HubDB(`together-r6-phone-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}
async function sealed(kind: JournalRow["kind"], date: string, suffix: string, entry: unknown): Promise<JournalRow> {
  const id = journalId(kind, date, suffix);
  return { id, kind, date, fp: jk.fp, ...(await sealJson(jk.key, entry, journalAad(id))) };
}
const phoneTick = (phone: HubDB, date: string, part: "exercise" | "checkin", on: boolean) =>
  sealed("share", date, part, { v: 1, private: on, at: Date.now() }).then((r) => phone.journal.put(r));

const ok = async (d: HubDB, s: FakeSyncServer) => expect((await syncOnce({ db: d, fetch: s.fetch })).kind).toBe("ok");
async function syncBoth(server: FakeSyncServer, phone: HubDB) {
  for (let i = 0; i < 2; i++) {
    await ok(db, server);
    await ok(phone, server);
  }
}
const habit = (kind: "exercise" | "checkin") => togetherId("habit", kind, 1);
async function liveNotes(fake: FakeSupabase, kind: "exercise" | "checkin" = "exercise"): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of fake.liveTallies(await habit(kind))) out[String(e.at).slice(0, 10)] = String(e.note ?? "");
  return out;
}
const postsWith = (fake: FakeSupabase, from: number, re: RegExp) =>
  fake.requests.slice(from).filter((r) => r.method === "POST" && r.url.includes("/rest/v1/todo_events") && re.test(r.body)).map((r) => r.body.slice(0, 160));
const restWrites = (fake: FakeSupabase, from: number) => fake.requests.slice(from).filter((r) => r.method !== "GET" && r.url.includes("/rest/v1/"));

async function hl(day: string, words: string, note = "") {
  const text = `A made-up learning text that says ${words} in the middle of it.`;
  const start = text.indexOf(words);
  const anchor = describeAnchor("learn", text, start, start + words.length)!;
  const card = { id: "b-001", track: "bpd", book: "Pretend first workbook", day: 1, chapter: 1, chapterTitle: "Pretend meadow", theme: "Pretend first-book one" };
  return createHighlight(jk, day, DEVICE, card, anchor, note);
}

/**
 * D's exercise (and check-in) with learned words "first"; synced; the backup is made; she then
 * replaces the learned words with "final" (synced). The answers go to Together with "final".
 */
async function sentWithAnswersAfterBackup(): Promise<{ c: Clock; fake: FakeSupabase; server: FakeSyncServer; phone: HubDB; file: unknown }> {
  const c = clock(`${D}T10:00:00`);
  const fake = await signedIn(c);
  const server = new FakeSyncServer(TOKEN);
  const phone = await phoneDevice();
  await journalDay(D, { exercise: true, checkin: true, learned: "Pretend Gildersleeve first words" });
  await syncBoth(server, phone);
  const file = JSON.parse(JSON.stringify(await exportBackup(D)));
  const day = await readLearned(jk, D);
  await saveLearned(jk, D, DEVICE, "Pretend Gildersleeve final words", { seen: day.seen });
  await syncBoth(server, phone);
  c.set("2026-11-06T03:30:00");
  expect((await send(fake, c)).kind).toBe("ok");
  const live = (await liveNotes(fake))[D]!;
  expect(live, "set-up: the answers went with the final words").toContain("Pretend Gildersleeve final words");
  expect(live).not.toContain("first words");
  return { c, fake, server, phone, file };
}

describe("#58 (b): a day already in Together WITH answers; after the Replace the server (not yet pulled) says private", () => {
  it("BUG: Send now in the gap re-sends nothing: never the restored (older) words, which she had replaced and never sent, into a day she ticked private", async () => {
    const { c, fake, phone, server, file } = await sentWithAnswersAfterBackup();
    await stopSyncing(db); // Replace is only possible with sync off on this device
    await phoneTick(phone, D, "exercise", true); // the phone ticks the day private (synced; the Mac hasn't pulled it)
    await ok(phone, server);
    await restoreBackup(file, "replace");
    const from = fake.requests.length;
    await send(fake, c, true); // "Send now" on the Sync page, sync still off
    expect(postsWith(fake, from, /Gildersleeve first words/), "words she replaced (never sent) went to Together, for a day ticked private on the server").toEqual([]);
    expect(postsWith(fake, from, /Pretend exercise answer/), "a private day's answers were inserted again").toEqual([]);
  });

  it("BUG: (not even private) Send now in the gap never sends the restored older version over what Together has", async () => {
    const { c, fake, file } = await sentWithAnswersAfterBackup();
    await stopSyncing(db);
    await restoreBackup(file, "replace");
    const from = fake.requests.length;
    await send(fake, c, true);
    expect(postsWith(fake, from, /Gildersleeve first words/), "replaced words she never sent went to Together after the Replace").toEqual([]);
  });

  it("sync back on: as soon as the pull lands the next run hides the day (titles only), and the restored file's older tick row never wins over the server's", async () => {
    const { c, fake, phone, server, file } = await sentWithAnswersAfterBackup();
    await stopSyncing(db);
    await phoneTick(phone, D, "exercise", true);
    await ok(phone, server);
    await restoreBackup(file, "replace");
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    await ok(db, server);
    expect((await db.syncMeta.get("firstPullDone"))?.value).toBe(true);
    expect((await readSharePrivate(jk, D)).exercise).toBe(true);
    await send(fake, c);
    const live = (await liveNotes(fake))[D] ?? "";
    expect(live).not.toMatch(/Gildersleeve|Pretend exercise answer|What I learned/);
    expect(fake.liveTallies(await habit("exercise"))).toHaveLength(1);
    await ok(phone, server);
    const phoneRow = (await phone.journal.get(`share:${D}:exercise`))!;
    const { openJson } = await import("../journal/crypto");
    expect((await openJson<{ private: boolean }>(jk.key, phoneRow, journalAad(phoneRow.id))).private, "the phone's tick still on after the Mac's restored rows synced").toBe(true);
  });
});

describe("#58 (a): a day the record says went titles only", () => {
  for (const when of ["ticked private before the backup", "ticked private after the backup"] as const) {
    it(`(${when}, hidden) never gets answers in the gap, nor after the pull`, async () => {
      const c = clock(`${D}T10:00:00`);
      const fake = await signedIn(c);
      const server = new FakeSyncServer(TOKEN);
      const phone = await phoneDevice();
      await journalDay(D, { exercise: true, checkin: true, learned: "Pretend Hollowmere learned" });
      await hl(D, "pretend Hollowmere gate", "Pretend Hollowmere note");
      c.set("2026-11-06T03:30:00");
      await send(fake, c);
      expect((await liveNotes(fake))[D], "set-up: answers went").toContain("Hollowmere note");
      if (when === "ticked private before the backup") {
        await saveSharePrivate(jk, D, "exercise", true);
        await saveSharePrivate(jk, D, "checkin", true);
        await send(fake, c);
      }
      await syncBoth(server, phone);
      const file = JSON.parse(JSON.stringify(await exportBackup(D)));
      if (when === "ticked private after the backup") {
        await saveSharePrivate(jk, D, "exercise", true);
        await saveSharePrivate(jk, D, "checkin", true);
        await syncBoth(server, phone);
        await send(fake, c);
      }
      expect((await readSent(db))!.tallies[`exercise:${D}`]).toMatchObject({ live: true, answers: false });
      await stopSyncing(db);
      await restoreBackup(file, "replace");
      expect((await readSent(db))!.tallies[`exercise:${D}`], "(d) the device-local record survives the Replace").toMatchObject({ live: true, answers: false });
      const from = fake.requests.length;
      for (let i = 0; i < 3; i++) {
        c.advance(60 * 60 * 1000);
        await send(fake, c, true);
      }
      await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
      await ok(db, server);
      await send(fake, c);
      await send(fake, c);
      expect(postsWith(fake, from, /Hollowmere|Pretend exercise answer|Pretend check-in answer/)).toEqual([]);
      expect(restWrites(fake, from).filter((r) => r.url.includes("todo_events")), "nothing re-sent at all").toEqual([]);
    });
  }
});

describe("#58 (c): words written after the Replace", () => {
  it("a highlight note and learned words added in the gap on a day already sent with answers: in Together once each, not repeated after the pull", async () => {
    const { c, fake, server, file } = await sentWithAnswersAfterBackup();
    await stopSyncing(db);
    await restoreBackup(file, "replace");
    const hid = await hl(D, "pretend Inglenook lane");
    const h = (await listHighlights(jk)).highlights.find((x) => x.hids.includes(hid))!;
    await saveHighlightNote(jk, DEVICE, openNoteSession(h), "Pretend Inglenook note after the Replace");
    await saveSharePrivate(jk, D0, "exercise", false); // an unrelated write
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    await ok(db, server);
    const from = fake.requests.length;
    await send(fake, c);
    await send(fake, c);
    const live = (await liveNotes(fake))[D]!;
    expect(live.split("Pretend Inglenook note after the Replace").length - 1).toBe(1);
    expect(live).toContain("Pretend Gildersleeve final words");
    expect(postsWith(fake, from, /Inglenook note/)).toHaveLength(1);
    expect(fake.liveTallies(await habit("exercise"))).toHaveLength(1);
  });

  it("a day not yet due when restored waits in the gap (titles only), then its answers go once after the pull", async () => {
    const c = clock(`${D}T10:00:00`);
    const fake = await signedIn(c);
    const server = new FakeSyncServer(TOKEN);
    const phone = await phoneDevice();
    await journalDay(D, { exercise: true, checkin: true });
    await syncBoth(server, phone);
    const file = JSON.parse(JSON.stringify(await exportBackup(D)));
    await stopSyncing(db);
    await restoreBackup(file, "replace");
    await saveLearned(jk, D, DEVICE, "Pretend Juniper learned after the Replace");
    c.set("2026-11-06T03:30:00");
    const from = fake.requests.length;
    await send(fake, c, true);
    expect(postsWith(fake, from, /Juniper|Pretend exercise answer/), "answers before the pull").toEqual([]);
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    await ok(db, server);
    await send(fake, c);
    await send(fake, c);
    expect(postsWith(fake, from, /Juniper learned after the Replace/)).toHaveLength(1);
  });
});

describe("#58: a device that Replaced and never syncs again", () => {
  it("BUG: with no sync on this device (never turned back on), a day's answers never follow after a Replace, however long she waits", async () => {
    await stopSyncing(db);
    await db.syncMeta.delete("firstPullDone");
    const c = clock(`${D}T10:00:00`);
    const fake = await signedIn(c);
    await journalDay(D, { exercise: true });
    const file = JSON.parse(JSON.stringify(await exportBackup(D)));
    await restoreBackup(file, "replace");
    for (const at of ["2026-11-06T03:30:00", "2026-11-10T03:30:00", "2026-12-01T03:30:00"]) {
      c.set(at);
      await send(fake, c, true);
    }
    expect((await liveNotes(fake))[D], "answers held for good after a Replace on a device without sync").toContain("Pretend exercise answer");
  });
});

describe("#58: the device that sends never Replaced (the other device did)", () => {
  it("keeps sending answers normally while the other device's restored rows arrive", async () => {
    const c = clock(`${D}T10:00:00`);
    const fake = await signedIn(c);
    const server = new FakeSyncServer(TOKEN);
    const phone = await phoneDevice();
    await journalDay(D, { exercise: true, learned: "Pretend Kittiwake learned" });
    await syncBoth(server, phone);
    // The phone's Replace: its restored rows keep old stamps; new rows under a new phone id.
    await sealed("learned", D, "device-pretend-phone-new-9_0a1b", { v: 1, text: "Pretend Kittiwake learned, the phone after its Replace", at: Date.now() }).then((r) => phone.journal.put(r));
    await syncBoth(server, phone);
    c.set("2026-11-06T03:30:00");
    await send(fake, c);
    expect((await liveNotes(fake))[D]).toContain("Pretend Kittiwake learned, the phone after its Replace");
  });
});
