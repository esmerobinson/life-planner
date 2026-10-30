import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "./db";
import { exportBackup, INVALID_BACKUP, parseBackup, restoreBackup } from "./backup";
import {
  addMorningPhoto, CANT_OPEN, currentStep, ensureCheckinSet, finishMorningPage, listCheckinDays, listMorningDone,
  listReadBack, morningOpensOn, NOT_CONFIRMED, openJournalPhoto, readCheckinDay, readMorningDay, readMorningPage,
  readPromptSettings, saveAnswer, saveMorningDraft, savePromptSettings, getFile,
} from "./repo";
import { journalId, validFile, validJournal } from "./validate";
import { journalAad, openJson, sealJson, toBase64, type JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";

// The journal (journal brief §3; review C1, C2, I3): every part of a day is its own sealed
// row; only the confirmed key writes; a row that doesn't open is skipped on its own.

const DAY = "2026-10-28";
const ME = "device-mac-0001";
const WORDS = "Pretend morning words about a made-up dream";
let jk: JournalKey;
let other: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-journal-one");
  other = await keyFor("fake-journal-two");
});

let clock = 1_800_000_000_000;
beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock++);
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear()]);
  await confirmedDevice(db, jk);
});
afterEach(() => vi.restoreAllMocks());

const IV16 = toBase64(new Uint8Array(12));
const FP = "0123456789abcdef";
const row = (o: Record<string, unknown> = {}) => ({
  id: "page:2026-10-28:abc", kind: "page", date: "2026-10-28", fp: FP, iv: IV16, ct: "AAAAAAAAAAAAAAAAAAAAAA==", ...o,
});
/** A row of `kind` sealed with `key` (as another device would have written it). */
async function sealedRow(key: JournalKey, kind: string, date: string, suffix: string | undefined, entry: unknown) {
  const id = journalId(kind as never, date, suffix);
  return { id, kind: kind as never, date, fp: key.fp, ...(await sealJson(key.key, entry, journalAad(id))) };
}

describe("validJournal", () => {
  it("accepts each kind with its id rule and a fingerprint", () => {
    expect(validJournal(row())).toBe(true);
    expect(validJournal(row({ id: "photo:2026-10-28:f-1", kind: "photo" }))).toBe(true);
    expect(validJournal(row({ id: `draft:2026-10-28:${ME}`, kind: "draft" }))).toBe(true);
    expect(validJournal(row({ id: "answer:2026-10-28:M1", kind: "answer" }))).toBe(true);
    expect(validJournal(row({ id: "set:2026-10-28", kind: "set" }))).toBe(true);
    expect(validJournal(row({ id: "settings", kind: "settings" }))).toBe(true);
    expect(validJournal(row({ id: "verifier", kind: "verifier" }))).toBe(true);
    // The earlier one-row-per-day shape is still readable (no fingerprint).
    const { fp: _fp, ...legacy } = row({ id: "morning:2026-10-28", kind: "morning" });
    expect(validJournal(legacy)).toBe(true);
  });

  it("refuses plaintext fields, a missing fingerprint on new rows, bad ids, and the dropped plan kind", () => {
    expect(validJournal(row({ text: "Pretend" }))).toBe(false);
    const { fp: _fp, ...noFp } = row();
    expect(validJournal(noFp)).toBe(false);
    expect(validJournal(row({ fp: "XYZ" }))).toBe(false);
    expect(validJournal(row({ id: "page:2026-10-27:abc" }))).toBe(false);
    expect(validJournal(row({ id: "page:2026-10-28:" }))).toBe(false);
    expect(validJournal(row({ id: "page:2026-10-28:a b" }))).toBe(false);
    expect(validJournal(row({ id: "set:2026-10-28:x", kind: "set" }))).toBe(false);
    expect(validJournal(row({ id: "plan", kind: "plan" }))).toBe(false);
    expect(validJournal(row({ iv: "short" }))).toBe(false);
    expect(validJournal(row({ ct: "not base64!" }))).toBe(false);
  });

  it("an encrypted photo file carries its IV (and may carry a fingerprint); a plain picture carries neither", () => {
    const file = { id: "f", mime: "image/jpeg", data: "AAAA", width: 4, height: 3, createdAt: DAY };
    expect(validFile(file)).toBe(true);
    expect(validFile({ ...file, encrypted: true, iv: IV16, fp: FP })).toBe(true);
    expect(validFile({ ...file, encrypted: true })).toBe(false);
    expect(validFile({ ...file, iv: IV16 })).toBe(false);
    expect(validFile({ ...file, fp: FP })).toBe(false);
  });
});

describe("only the confirmed key writes", () => {
  it("another key (a candidate, a stale one) is refused inside the write and nothing is stored", async () => {
    const before = await db.journal.count();
    await expect(saveMorningDraft(other, DAY, ME, "Pretend")).rejects.toThrow(NOT_CONFIRMED);
    await db.syncMeta.delete("journalKey"); // e.g. the view still holds a key that is gone
    await expect(saveMorningDraft(jk, DAY, ME, "Pretend")).rejects.toThrow(NOT_CONFIRMED);
    await expect(saveAnswer(jk, DAY, "M1", ME, "Pretend", false)).rejects.toThrow(NOT_CONFIRMED);
    expect(await db.journal.count()).toBe(before);
  });
});

describe("morning pages (each part its own row)", () => {
  it("a draft is this device's own sealed row: no plaintext, fingerprinted, pending for sync", async () => {
    await saveMorningDraft(jk, DAY, ME, WORDS);
    const stored = (await db.journal.get(`draft:${DAY}:${ME}`))!;
    expect(Object.keys(stored).sort()).toEqual(["ct", "date", "fp", "id", "iv", "kind", "updatedAt"]);
    expect(stored.fp).toBe(jk.fp);
    expect(JSON.stringify(stored)).not.toContain("Pretend");
    expect(await db.pending.get(["journal", stored.id])).toBeTruthy();
    expect(await readMorningDay(jk, DAY, ME)).toMatchObject({ done: false, draft: WORDS });
    expect((await readMorningDay(jk, DAY, "device-phone-01")).draft).toBe(""); // another device's draft is its own
  });

  it("I'm done adds a page row and empties the draft; another page that day is another row", async () => {
    await saveMorningDraft(jk, DAY, ME, WORDS);
    await finishMorningPage(jk, DAY, ME, WORDS);
    const view = await readMorningDay(jk, DAY, ME);
    expect(view).toEqual({ date: DAY, done: true, pages: 1, draft: "", photos: [], unreadable: 0 });
    expect(JSON.stringify(view)).not.toContain("Pretend");
    await finishMorningPage(jk, DAY, ME, "Pretend second page");
    expect((await readMorningDay(jk, DAY, ME)).pages).toBe(2);
    expect((await db.journal.where("kind").equals("page").toArray()).map((r) => r.date)).toEqual([DAY, DAY]);
    expect(await listMorningDone(jk)).toEqual(new Set([DAY]));
  });

  it("a photo: an encrypted file row plus a photo row; the day is done; it opens only with this key", async () => {
    const jpeg = toBase64(Uint8Array.from([255, 216, 255, 224, 1, 2, 3]));
    const id = await addMorningPhoto(jk, DAY, { mime: "image/jpeg", data: jpeg, width: 40, height: 30 });
    const f = (await db.files.get(id))!;
    expect(f).toMatchObject({ encrypted: true, fp: jk.fp, mime: "image/jpeg", createdAt: DAY });
    expect(f.data).not.toBe(jpeg);
    expect(await db.journal.get(`photo:${DAY}:${id}`)).toMatchObject({ kind: "photo", fp: jk.fp });
    expect(await readMorningDay(jk, DAY, ME)).toMatchObject({ done: true, pages: 0, photos: [id] });
    const opened = await openJournalPhoto(jk, id);
    expect(toBase64(new Uint8Array(await (opened as { blob: Blob }).blob.arrayBuffer()))).toBe(jpeg);
    expect((await openJournalPhoto(other, id)).state).toBe("unreadable");
    expect((await openJournalPhoto(jk, "not-here-yet")).state).toBe("missing");
    expect(await getFile(id)).toBeUndefined(); // never shown as a page's picture (review M9)
  });

  it("a row this key can't open is skipped on its own and blocks nothing (review I3)", async () => {
    await db.journal.put(await sealedRow(other, "draft", DAY, ME, { v: 1, text: "Pretend other" }));
    await db.journal.put(await sealedRow(other, "page", DAY, "theirs", { v: 1, text: "Pretend other", at: 1 }));
    const view = await readMorningDay(jk, DAY, ME);
    expect(view).toMatchObject({ done: true, pages: 1, unreadable: 1, draft: "" });
    // New parts are new rows: writing still works and the unreadable rows are untouched.
    const before = await db.journal.get(`page:${DAY}:theirs`);
    await finishMorningPage(jk, DAY, ME, "Pretend mine");
    expect((await readMorningDay(jk, DAY, ME)).pages).toBe(2);
    expect(await db.journal.get(`page:${DAY}:theirs`)).toEqual(before);
    expect(CANT_OPEN).toBe("Can't open this entry on this device");
  });

  it("the earlier one-row-per-day shape is split on read", async () => {
    const legacyId = "morning:2026-10-20";
    const sealed = await sealJson(jk.key, { v: 1, text: "Pretend legacy", pages: 1, photos: ["f-old"], draft: "Pretend legacy draft" }, journalAad(legacyId));
    await db.journal.put({ id: legacyId, kind: "morning", date: "2026-10-20", ...sealed });
    expect(await readMorningDay(jk, "2026-10-20", ME)).toMatchObject({ done: true, pages: 1, photos: ["f-old"], draft: "Pretend legacy draft" });
    expect(await listMorningDone(jk)).toEqual(new Set(["2026-10-20"]));
    expect(await readMorningPage(jk, legacyId, "2026-11-30")).toEqual({ state: "ok", text: "Pretend legacy" });
  });
});

describe("read back (each page hidden for 4 weeks)", () => {
  it("locked before day 28 (not even decrypted), readable read-only on and after day 28", async () => {
    const id = await finishMorningPage(jk, "2026-10-01", ME, WORDS);
    expect(morningOpensOn("2026-10-01")).toBe("2026-10-29");
    expect(await listReadBack()).toEqual([{ id, date: "2026-10-01" }]);
    const decrypt = vi.spyOn(crypto.subtle, "decrypt");
    expect(await readMorningPage(jk, id, "2026-10-01")).toEqual({ state: "locked", opensOn: "2026-10-29" });
    expect(await readMorningPage(jk, id, "2026-10-28")).toEqual({ state: "locked", opensOn: "2026-10-29" });
    expect(decrypt).not.toHaveBeenCalled();
    expect(await readMorningPage(jk, id, "2026-10-29")).toEqual({ state: "ok", text: WORDS });
    expect(await readMorningPage(jk, id, "2027-03-01")).toEqual({ state: "ok", text: WORDS });
  });

  it("across a year boundary; each page of a day separately; another key can't read", async () => {
    const a = await finishMorningPage(jk, "2026-12-20", ME, "Pretend winter one");
    const b = await finishMorningPage(jk, "2026-12-20", ME, "Pretend winter two");
    expect((await readMorningPage(jk, a, "2027-01-16")).state).toBe("locked");
    expect(await readMorningPage(jk, a, "2027-01-17")).toEqual({ state: "ok", text: "Pretend winter one" });
    expect(await readMorningPage(jk, b, "2027-01-17")).toEqual({ state: "ok", text: "Pretend winter two" });
    expect((await readMorningPage(other, a, "2027-02-01")).state).toBe("unreadable");
  });
});

describe("check-in (a set row plus one row per answer)", () => {
  it("the first device writes the day's set; a second set is never written over it", async () => {
    expect(await ensureCheckinSet(jk, DAY, ["M1", "D3", "K2"])).toBe(true);
    expect(await ensureCheckinSet(jk, DAY, ["E3", "E6", "K4"])).toBe(false);
    const day = await readCheckinDay(jk, DAY);
    expect(day.prompts).toEqual(["M1", "D3", "K2"]);
    expect(currentStep(day)).toBe(0);
  });

  it("answers are separate rows; a typed-but-not-moved-past answer keeps the step; done moves on", async () => {
    await ensureCheckinSet(jk, DAY, ["M1", "D3", "K2"]);
    await saveAnswer(jk, DAY, "M1", ME, "Pretend typing", false);
    let day = await readCheckinDay(jk, DAY);
    expect(day.answers.get("M1")).toMatchObject({ answer: "Pretend typing", done: false });
    expect(currentStep(day)).toBe(0);
    await saveAnswer(jk, DAY, "M1", ME, "Pretend typing", true);
    await saveAnswer(jk, DAY, "D3", ME, null, true);
    await saveAnswer(jk, DAY, "K2", ME, "Pretend kind", true);
    day = await readCheckinDay(jk, DAY);
    expect(currentStep(day)).toBe(-1);
    expect(JSON.stringify(await db.journal.toArray())).not.toContain("Pretend");
  });

  it("each device answers in its own row, named by an opaque prompt key (no prompt id in clear)", async () => {
    await saveAnswer(jk, DAY, "M1", ME, "Pretend", false);
    const [row] = await db.journal.where("kind").equals("answer").toArray();
    expect(row!.id).toMatch(/^answer:2026-10-28:[0-9a-f]{12}:device-mac-0001$/);
    expect(row!.id).not.toContain("M1");
    expect(validJournal(row)).toBe(true);
    expect(validJournal({ ...row, id: "answer:2026-10-28:M1" })).toBe(true); // the earlier shared shape still reads
    expect(validJournal({ ...row, id: "answer:2026-10-28:ABCDEF:device-mac-0001" })).toBe(false);
  });

  it("merging devices: the newest non-empty answer shows; an empty skip from another device never hides it", async () => {
    await ensureCheckinSet(jk, DAY, ["M1", "D3", "K2"]);
    await saveAnswer(jk, DAY, "M1", "device-phone-01", "Pretend phone answer", true);
    await saveAnswer(jk, DAY, "M1", ME, null, true); // the Mac skips later
    expect((await readCheckinDay(jk, DAY)).answers.get("M1")).toMatchObject({ answer: "Pretend phone answer", done: true });
    await saveAnswer(jk, DAY, "M1", ME, "Pretend mac edit", true); // she edits on the Mac
    expect((await readCheckinDay(jk, DAY)).answers.get("M1")).toMatchObject({ answer: "Pretend mac edit" });
    expect(await db.journal.where("kind").equals("answer").count()).toBe(2);
  });

  it("answers to prompts outside the set (another device's set) are kept and shown after it", async () => {
    await ensureCheckinSet(jk, DAY, ["M1", "D3", "K2"]);
    await saveAnswer(jk, DAY, "E3", ME, "Pretend from the phone's set", true);
    const day = await readCheckinDay(jk, DAY);
    expect(day.prompts).toEqual(["M1", "D3", "K2", "E3"]);
  });

  it("the earlier one-row-per-day check-in is split on read", async () => {
    const id = "checkin:2026-10-20";
    const sealed = await sealJson(jk.key, { v: 1, prompts: ["M1", "K2"], answers: ["Pretend old", null], step: 2, finished: true }, journalAad(id));
    await db.journal.put({ id, kind: "checkin", date: "2026-10-20", ...sealed });
    const day = await readCheckinDay(jk, "2026-10-20");
    expect(day.prompts).toEqual(["M1", "K2"]);
    expect(day.answers.get("M1")).toMatchObject({ answer: "Pretend old", done: true });
    expect(currentStep(day)).toBe(-1);
    expect((await listCheckinDays(jk)).map((d) => d.date)).toEqual(["2026-10-20"]);
  });

  it("Choose questions is a synced, sealed settings row", async () => {
    expect(await readPromptSettings(jk)).toBeNull();
    await savePromptSettings(jk, ["M1", "M3"], DAY);
    expect(await readPromptSettings(jk)).toEqual(["M1", "M3"]);
    expect(await db.journal.get("settings")).toMatchObject({ kind: "settings", fp: jk.fp });
    expect(await readPromptSettings(other)).toBeNull();
  });
});

describe("backup with the journal", () => {
  it("contains the sealed rows as they are; replace brings them back; a plaintext field refuses the file", async () => {
    await finishMorningPage(jk, DAY, ME, WORDS);
    await saveAnswer(jk, DAY, "M1", ME, "Pretend", true);
    const exported = JSON.parse(JSON.stringify(await exportBackup(DAY)));
    expect(exported.journal.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(exported)).not.toContain("Pretend");
    await db.journal.clear();
    await restoreBackup(exported, "replace");
    expect((await readMorningDay(jk, DAY, ME)).done).toBe(true);
    const bad = { ...exported, journal: [{ ...exported.journal[0], text: "Pretend" }] };
    expect(() => parseBackup(bad)).toThrow(INVALID_BACKUP);
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

it("open-the-JSON helper still works for tests that need it", async () => {
  const id = await finishMorningPage(jk, DAY, ME, "Pretend");
  const r = (await db.journal.get(id))!;
  expect(await openJson(jk.key, r, journalAad(id))).toMatchObject({ v: 1, text: "Pretend" });
});
