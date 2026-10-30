import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "./db";
import { exportBackup, INVALID_BACKUP, parseBackup, restoreBackup } from "./backup";
import {
  addMorningPhoto, CANT_OPEN, finishMorningPage, listCheckins, listMorningDays, openJournalPhoto, readCheckin,
  morningOpensOn, readMorningDay, readMorningText, saveCheckin, saveMorningDraft,
} from "./repo";
import { journalId, validFile, validJournal } from "./validate";
import { deriveJournalKey, journalAad, openJson, sealJson, toBase64 } from "../journal/crypto";
import type { MorningEntry } from "../journal/entries";

// The journal (journal brief §3): sealed rows only, validated, tracked for sync, backed up
// as they are; morning pages' text never comes back out.

const DAY = "2026-10-28";
const WORDS = "Pretend morning words about a made-up dream";
let key: CryptoKey;
let otherKey: CryptoKey;
beforeAll(async () => {
  key = await deriveJournalKey("pretend passphrase one");
  otherKey = await deriveJournalKey("pretend passphrase two");
});

let clock = 1_800_000_000_000;
beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock++);
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
});
afterEach(() => vi.restoreAllMocks());

const IV16 = toBase64(new Uint8Array(12));
const row = (o: Record<string, unknown> = {}) => ({
  id: "morning:2026-10-28", kind: "morning", date: "2026-10-28", iv: IV16, ct: "AAAAAAAAAAAAAAAAAAAAAA==", ...o,
});

describe("validJournal", () => {
  it("accepts a sealed row for each kind, with its deterministic id", () => {
    expect(validJournal(row())).toBe(true);
    expect(validJournal(row({ id: "checkin:2026-10-28", kind: "checkin" }))).toBe(true);
    expect(validJournal(row({ updatedAt: 5 }))).toBe(true);
    expect(journalId("morning", DAY)).toBe("morning:2026-10-28");
    expect(journalId("checkin", DAY)).toBe("checkin:2026-10-28");
  });

  it("refuses anything but the sealed fields (plaintext by mistake can never be stored or sent)", () => {
    expect(validJournal(row({ text: "Pretend" }))).toBe(false);
    expect(validJournal(row({ answers: [] }))).toBe(false);
  });

  it("refuses a wrong id, kind, date, IV or ciphertext", () => {
    expect(validJournal(row({ id: "morning:2026-10-27" }))).toBe(false);
    expect(validJournal(row({ id: "x" }))).toBe(false);
    expect(validJournal(row({ kind: "diary" }))).toBe(false);
    expect(validJournal(row({ id: "morning:2026-02-30", date: "2026-02-30" }))).toBe(false);
    expect(validJournal(row({ iv: "short" }))).toBe(false);
    expect(validJournal(row({ ct: "" }))).toBe(false);
    expect(validJournal(row({ ct: "not base64!" }))).toBe(false);
    expect(validJournal(row({ id: "plan", kind: "plan" }))).toBe(false); // no crisis-plan kind (dropped from scope)
  });
});

describe("validFile for journal photos", () => {
  const file = { id: "f", mime: "image/jpeg", data: "AAAA", width: 4, height: 3, createdAt: DAY };
  it("an encrypted photo carries a 12-byte IV; a plain picture carries neither", () => {
    expect(validFile(file)).toBe(true);
    expect(validFile({ ...file, encrypted: true, iv: IV16 })).toBe(true);
    expect(validFile({ ...file, encrypted: true })).toBe(false);
    expect(validFile({ ...file, iv: IV16 })).toBe(false);
    expect(validFile({ ...file, encrypted: false, iv: IV16 })).toBe(false);
    expect(validFile({ ...file, encrypted: true, iv: "bad" })).toBe(false);
  });
});

describe("morning pages", () => {
  it("a draft is stored sealed: the stored object holds no plaintext, and it is pending for sync", async () => {
    await saveMorningDraft(key, DAY, WORDS);
    const stored = await db.journal.get("morning:2026-10-28");
    expect(Object.keys(stored!).sort()).toEqual(["ct", "date", "id", "iv", "kind", "updatedAt"]);
    expect(JSON.stringify(stored)).not.toContain("Pretend");
    expect(JSON.stringify(stored)).not.toContain("dream");
    expect(await db.pending.get(["journal", "morning:2026-10-28"])).toBeTruthy();
    expect(await readMorningDay(key, DAY)).toMatchObject({ state: "ok", done: false, draft: WORDS });
  });

  it("I'm done: the day is done and the finished text never comes back out; a second page appends", async () => {
    await saveMorningDraft(key, DAY, WORDS);
    await finishMorningPage(key, DAY, WORDS);
    const view = await readMorningDay(key, DAY);
    expect(view).toEqual({ date: DAY, state: "ok", done: true, pages: 1, draft: "", photos: [] });
    expect(JSON.stringify(view)).not.toContain("Pretend");
    await finishMorningPage(key, DAY, "Pretend second page");
    const days = await listMorningDays(key);
    expect(days).toHaveLength(1);
    expect(JSON.stringify(days)).not.toContain("Pretend");
    // It is all there, sealed (opened here by hand, as no app read returns it).
    const raw = await db.journal.get("morning:2026-10-28");
    const entry = await openJson<MorningEntry>(key, raw!, journalAad(raw!.id));
    expect(entry.text).toBe(`${WORDS}\n\nPretend second page`);
    expect(entry.pages).toBe(2);
  });

  it("a photo is sealed into an encrypted file row, listed on the day, and marks it done", async () => {
    const jpeg = toBase64(Uint8Array.from([255, 216, 255, 224, 1, 2, 3]));
    const id = await addMorningPhoto(key, DAY, { mime: "image/jpeg", data: jpeg, width: 40, height: 30 });
    const f = await db.files.get(id);
    expect(f).toMatchObject({ encrypted: true, mime: "image/jpeg", width: 40, height: 30, createdAt: DAY });
    expect(f!.data).not.toBe(jpeg);
    expect(validFile(f)).toBe(true);
    expect(await db.pending.get(["files", id])).toBeTruthy();
    expect(await readMorningDay(key, DAY)).toMatchObject({ done: true, pages: 0, photos: [id] });
    const opened = await openJournalPhoto(key, id);
    expect(opened.state).toBe("ok");
    const bytes = new Uint8Array(await (opened as { blob: Blob }).blob.arrayBuffer());
    expect(toBase64(bytes)).toBe(jpeg);
    expect((await openJournalPhoto(otherKey, id)).state).toBe("unreadable");
    expect((await openJournalPhoto(key, "not-here-yet")).state).toBe("missing");
  });

  it("a wrong key: the day can't be opened, and nothing is written over it", async () => {
    await finishMorningPage(key, DAY, WORDS);
    const before = await db.journal.get("morning:2026-10-28");
    expect(await readMorningDay(otherKey, DAY)).toMatchObject({ state: "unreadable", done: false });
    await expect(saveMorningDraft(otherKey, DAY, "Pretend")).rejects.toThrow(CANT_OPEN);
    await expect(finishMorningPage(otherKey, DAY, "Pretend")).rejects.toThrow(CANT_OPEN);
    expect(await db.journal.get("morning:2026-10-28")).toEqual(before);
  });

  it("a tampered row can't be opened (no crash)", async () => {
    await finishMorningPage(key, DAY, WORDS);
    const r = (await db.journal.get("morning:2026-10-28"))!;
    // Another day's sealed entry copied into this row (still a valid row shape).
    await saveMorningDraft(key, "2026-10-27", "Pretend");
    const other = (await db.journal.get("morning:2026-10-27"))!;
    await db.journal.put({ ...r, iv: other.iv, ct: other.ct });
    expect((await readMorningDay(key, DAY)).state).toBe("unreadable");
  });
});

describe("read back (typed pages hidden for 4 weeks)", () => {
  it("locked before day 28 (and not even decrypted), readable read-only on and after day 28", async () => {
    await finishMorningPage(key, "2026-10-01", WORDS);
    expect(morningOpensOn("2026-10-01")).toBe("2026-10-29");
    const decrypt = vi.spyOn(crypto.subtle, "decrypt");
    expect(await readMorningText(key, "2026-10-01", "2026-10-01")).toEqual({ state: "locked", opensOn: "2026-10-29" });
    expect(await readMorningText(key, "2026-10-01", "2026-10-28")).toEqual({ state: "locked", opensOn: "2026-10-29" });
    expect(decrypt).not.toHaveBeenCalled();
    expect(await readMorningText(key, "2026-10-01", "2026-10-29")).toEqual({ state: "ok", text: WORDS });
    expect(await readMorningText(key, "2026-10-01", "2027-03-01")).toEqual({ state: "ok", text: WORDS });
  });

  it("across a month and year boundary; a draft-only day or a wrong key has nothing to read", async () => {
    await finishMorningPage(key, "2026-12-20", "Pretend winter page");
    expect((await readMorningText(key, "2026-12-20", "2027-01-16")).state).toBe("locked");
    expect(await readMorningText(key, "2026-12-20", "2027-01-17")).toEqual({ state: "ok", text: "Pretend winter page" });
    await saveMorningDraft(key, "2026-09-01", "Pretend draft");
    expect((await readMorningText(key, "2026-09-01", "2026-10-28")).state).toBe("none");
    expect((await readMorningText(otherKey, "2026-12-20", "2027-02-01")).state).toBe("unreadable");
  });
});

describe("check-ins", () => {
  it("saves, reads and lists check-ins newest first", async () => {
    await saveCheckin(key, "2026-10-27", { prompts: ["M1", "D3", "K2"], answers: ["Pretend", null, "Pretend kind"], step: 3, finished: true });
    await saveCheckin(key, DAY, { prompts: ["E3", "E6", "K4"], answers: ["Pretend", null, null], step: 1, finished: false });
    expect(await readCheckin(key, DAY)).toEqual({
      state: "ok", entry: { v: 1, prompts: ["E3", "E6", "K4"], answers: ["Pretend", null, null], step: 1, finished: false },
    });
    expect((await listCheckins(key)).map((c) => c.date)).toEqual([DAY, "2026-10-27"]);
    expect(JSON.stringify(await db.journal.toArray())).not.toContain("Pretend");
    await expect(saveCheckin(key, DAY, { prompts: ["E3"], answers: [], step: 0, finished: false })).rejects.toThrow();
  });
});

describe("backup with the journal", () => {
  it("contains the sealed rows as they are, and a replace restore brings them back", async () => {
    await finishMorningPage(key, DAY, WORDS);
    await saveCheckin(key, DAY, { prompts: ["E3", "E6", "K4"], answers: ["Pretend", null, null], step: 1, finished: false });
    const exported = JSON.parse(JSON.stringify(await exportBackup(DAY)));
    expect(exported.journal).toHaveLength(2);
    expect(JSON.stringify(exported)).not.toContain("Pretend");
    await db.journal.clear();
    await restoreBackup(exported, "replace");
    expect(await readMorningDay(key, DAY)).toMatchObject({ done: true });
    expect(await readCheckin(key, DAY)).toMatchObject({ entry: { answers: ["Pretend", null, null] } });
  });

  it("merge adds only missing entries; a row with a plaintext field refuses the whole file", async () => {
    const cid = "checkin:2026-10-28";
    await saveCheckin(key, DAY, { prompts: ["E3"], answers: ["Pretend kept"], step: 1, finished: true });
    const sealed = await sealJson(key, { v: 1, prompts: ["E3"], answers: ["Pretend other"], step: 1, finished: true }, journalAad(cid));
    const other = { id: cid, kind: "checkin", date: DAY, ...sealed };
    const morning = (await (async () => {
      await saveMorningDraft(key, "2026-10-01", "Pretend");
      const r = (await db.journal.get("morning:2026-10-01"))!;
      await db.journal.delete(r.id);
      return r;
    })());
    const file = { app: "life-hub", schema: 1, exportedOn: DAY, items: [], goals: [], journal: [other, morning] };
    await restoreBackup(file, "merge");
    expect(await readCheckin(key, DAY)).toMatchObject({ entry: { answers: ["Pretend kept"] } });
    expect(await db.journal.get("morning:2026-10-01")).toBeTruthy();
    expect(() => parseBackup({ ...file, journal: [{ ...other, text: "Pretend" }] })).toThrow(INVALID_BACKUP);
  });
});

describe("database v5", () => {
  it("an existing v4 database upgrades with its rows kept and an empty journal table", async () => {
    const name = "journal-upgrade-test";
    const old = new Dexie(name);
    old.version(1).stores({ items: "id, status, areaId, goalId, due", goals: "id" });
    old.version(2).stores({ syncMeta: "key", pending: "[table+id]" });
    old.version(3).stores({ quarantine: "[table+id]" });
    old.version(4).stores({ files: "id" });
    await old.open();
    await old.table("items").put({
      id: "kept", kind: "task", title: "Pretend kept", links: [], areaId: "art", priority: 2, status: "open",
      createdAt: DAY, touchedAt: DAY, updatedAt: 5,
    });
    old.close();
    const now = new HubDB(name);
    await now.open();
    expect(now.verno).toBe(5);
    expect(await now.items.get("kept")).toMatchObject({ title: "Pretend kept", updatedAt: 5 });
    expect(await now.journal.count()).toBe(0);
    now.close();
    await Dexie.delete(name);
  });
});
