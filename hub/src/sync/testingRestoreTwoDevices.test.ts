// Testing session (restore-safe ripples): two devices, the phone untouched, the Mac Replaces with
// an older backup and carries on as normal. Afterwards both devices hold the same rows, every
// entry shows once, nothing is left waiting to send, and the id rules hold around sync settings
// (a new sync address, Stop syncing) and a second Replace.
// Repo reads run against the Mac (the default db); the phone is compared row by row (its views
// are worked out from the same rows). Fictional words only; fake servers only.

import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import { exportBackup, restoreBackup } from "../data/backup";
import { formerDeviceIds } from "../data/deviceIds";
import {
  finishMorningPage, listCheckinDays, listExerciseEntries, listNoteReads, listNotes, listReadBack, readCheckinDay,
  readExerciseProgress, readMorningDay, saveAnswer, saveMorningDraft, saveNote, setExerciseStar, setNoteRead, submitExerciseEntry,
} from "../data/repo";
import type { JournalRow } from "../domain/types";
import { journalAad, openJson, type JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { FakeSyncServer } from "./fakeServer";
import { getDeviceId, saveSyncSettings, stopSyncing, syncOnce } from "./engine";

const TOKEN = "7e57".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const SERVER2 = "https://sync-two.example.test";
const D1 = "2026-11-03";
const D2 = "2026-11-04";
const D3 = "2026-11-05";
const CARD = { id: "pretend-card-1", day: 1, theme: "Pretend theme", legacy: false };
const Q = "Pretend question?";
const NOTE = { prompt: null, thought: "Pretend thought", memory: "", skill: "" };
let jk: JournalKey;
const open: HubDB[] = [];
beforeAll(async () => {
  jk = await keyFor("fake-journal-restore-two-devices");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear(), db.items.clear(), db.goals.clear(), db.files.clear(), db.farm.clear()]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

const later = () => new Promise((r) => setTimeout(r, 5));
async function sync(d: HubDB, server: FakeSyncServer) {
  const out = await syncOnce({ db: d, fetch: server.fetch });
  expect(out.kind).toBe("ok");
  return out as { kind: "ok"; sent: number; received: number };
}
const ok2 = (d: HubDB, server: FakeSyncServer) => sync(d, server);
const rowSet = async (d: HubDB) =>
  ((await d.journal.toArray()) as JournalRow[]).map((r) => `${r.id}@${r.updatedAt}`).sort();
async function pageTexts(d: HubDB): Promise<string[]> {
  const rows = (await d.journal.where("kind").equals("page").toArray()) as JournalRow[];
  return (await Promise.all(rows.map((r) => openJson(jk.key, r, journalAad(r.id)) as Promise<{ text: string }>))).map((e) => e.text).sort();
}
const newPhone = async (url = SERVER) => {
  const phone = new HubDB(`restore-two-phone-${Math.random()}`);
  open.push(phone);
  await saveSyncSettings(phone, { serverUrl: url, token: TOKEN });
  return phone;
};

/** Backup on the Mac, newer words on both devices (synced), then the Mac Replaces (sync off) and carries on offline. */
async function story() {
  const server = new FakeSyncServer(TOKEN);
  await confirmedDevice(db, jk);
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  const mac = await getDeviceId(db);
  const phone = await newPhone();
  // Before the backup.
  await finishMorningPage(jk, D1, mac, "Pretend page one.");
  await saveAnswer(jk, D1, Q, mac, "Pretend answer one", true);
  await submitExerciseEntry(jk, D1, mac, CARD, "Pretend exercise one");
  const note = await saveNote(jk, D1, mac, { ...NOTE, steady: "Pretend note words one" });
  await setNoteRead(jk, D1, mac, note, true);
  await setExerciseStar(jk, D1, mac, CARD.id, true);
  await saveMorningDraft(jk, D2, mac, "Pretend draft A.");
  await sync(db, server);
  await sync(phone, server);
  const backup = JSON.parse(JSON.stringify(await exportBackup(D2)));
  await later();
  // After the backup, both devices, synced.
  await saveMorningDraft(jk, D2, mac, "Pretend draft A. Then B.");
  await finishMorningPage(jk, D1, mac, "Pretend page two.");
  await saveAnswer(jk, D2, Q, mac, "Pretend answer two", true);
  const notes = await listNotes(jk, mac);
  await saveNote(jk, D1, mac, { ...NOTE, steady: "Pretend note words two" }, { id: note, seen: notes.notes[0]!.seen });
  await sync(db, server);
  await sync(phone, server);
  // The Mac: sync off, Replace, carry on as normal.
  await stopSyncing(db);
  await restoreBackup(backup, "replace");
  await later();
  const now = await getDeviceId(db);
  expect(now).not.toBe(mac);
  await finishMorningPage(jk, D3, now, "Pretend page three.");
  await saveAnswer(jk, D3, Q, now, "Pretend answer three", true);
  await setNoteRead(jk, D3, now, note, true);
  await setExerciseStar(jk, D3, now, "pretend-card-2", true);
  await later();
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  for (let i = 0; i < 2; i++) {
    await sync(db, server);
    await sync(phone, server);
  }
  return { server, phone, mac, now, note };
}

describe("phone untouched, the Mac Replaces and carries on", () => {
  it("both devices end with the same rows; every page, answer, exercise and note shows once; nothing waits to send", async () => {
    const { server, phone, mac, now, note } = await story();
    expect(await rowSet(db)).toEqual(await rowSet(phone));
    expect(await db.pending.count()).toBe(0);
    expect(await phone.pending.count()).toBe(0);
    // Every page once (no page from the restore appears twice).
    expect(await pageTexts(db)).toEqual(["Pretend page one.", "Pretend page three.", "Pretend page two."]);
    expect((await listReadBack()).length).toBe(3);
    // The newer draft written after the backup is her box on D2 (it came back from the server).
    expect((await readMorningDay(jk, D2, now)).draft).toBe("Pretend draft A. Then B.");
    // Check-in: one day each, the newest answers.
    const days = await listCheckinDays(jk);
    expect(days.map((d) => d.date)).toEqual([D3, D2, D1]);
    expect((await readCheckinDay(jk, D2)).answers.get(Q)!.answer).toBe("Pretend answer two");
    // Exercise: one entry, one star each (and the restored star still on).
    expect((await listExerciseEntries(jk, D3)).entries.map((e) => e.text)).toEqual(["Pretend exercise one"]);
    const stars = (await readExerciseProgress(jk)).starred;
    expect([...stars].sort()).toEqual([CARD.id, "pretend-card-2"]);
    // Notes: one note, the newer words, nothing else beside it.
    const { notes, drafts } = await listNotes(jk, now);
    expect(notes.map((n) => [n.steady, n.others.length])).toEqual([["Pretend note words two", 0]]);
    expect(drafts).toEqual([]);
    const reads = await listNoteReads(jk);
    expect([...reads.readOn(D1)]).toEqual([note]);
    expect([...reads.readOn(D3)]).toEqual([note]);
    expect([...reads.ownOn(D1, mac)]).toEqual([note]); // a page still open with the old id
    // Settled: a further run on each sends nothing, and the Mac still has its new id.
    expect((await sync(db, server)).sent).toBe(0);
    expect((await sync(phone, server)).sent).toBe(0);
    expect(await getDeviceId(db)).toBe(now);
  });

  it("a new sync address after the Replace: the new server gets every row (both ids), a fresh device there sees the same", async () => {
    const { now } = await story();
    const server2 = new FakeSyncServer(TOKEN);
    await saveSyncSettings(db, { serverUrl: SERVER2, token: TOKEN });
    await sync(db, server2);
    expect(await getDeviceId(db)).toBe(now); // an address change never changes the id
    const tablet = await newPhone(SERVER2);
    await sync(tablet, server2);
    expect(await rowSet(tablet)).toEqual(await rowSet(db));
    expect(await db.pending.count()).toBe(0);
  });

  it("changes still waiting to send at the Replace: the restored rows go up with their own stamps, nothing is stuck, the server's newer words win", async () => {
    const server = new FakeSyncServer(TOKEN);
    await confirmedDevice(db, jk);
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    const mac = await getDeviceId(db);
    await saveAnswer(jk, D1, Q, mac, "Pretend answer in the backup", true);
    await ok2(db, server);
    const backup = JSON.parse(JSON.stringify(await exportBackup(D1)));
    await later();
    await saveAnswer(jk, D1, Q, mac, "Pretend newer answer, synced", true);
    await ok2(db, server);
    await stopSyncing(db);
    await later();
    // Offline, before the Replace: a page and a newer answer, never sent.
    await finishMorningPage(jk, D2, mac, "Pretend page never sent.");
    await saveAnswer(jk, D1, Q, mac, "Pretend answer never sent", true);
    expect(await db.pending.count()).toBeGreaterThan(0);
    await restoreBackup(backup, "replace");
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    await ok2(db, server);
    await ok2(db, server);
    expect(await db.pending.count()).toBe(0);
    expect((await readCheckinDay(jk, D1)).answers.get(Q)!.answer).toBe("Pretend newer answer, synced");
    const phone = await newPhone();
    await sync(phone, server);
    expect(await rowSet(phone)).toEqual(await rowSet(db));
  });

  it("a second Replace (with the backup made after the first) keeps every id it ever had as former", async () => {
    const { server, phone, mac, now } = await story();
    const second = JSON.parse(JSON.stringify(await exportBackup(D3)));
    await later();
    await saveMorningDraft(jk, D3, now, "Pretend draft after the first Replace.");
    await sync(db, server);
    await sync(phone, server);
    await stopSyncing(db);
    await restoreBackup(second, "replace");
    await later();
    const third = await getDeviceId(db);
    expect(await formerDeviceIds()).toEqual([mac, now]);
    expect((await readMorningDay(jk, D3, third)).draft).toBe(""); // before sync: the second backup's (none)
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    await sync(db, server);
    await sync(phone, server);
    await sync(db, server);
    expect((await readMorningDay(jk, D3, third)).draft).toBe("Pretend draft after the first Replace.");
    expect(await rowSet(db)).toEqual(await rowSet(phone));
    expect(await pageTexts(db)).toEqual(["Pretend page one.", "Pretend page three.", "Pretend page two."]);
  });
});
