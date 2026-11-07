import { db } from "./db";
import { listSharePrivate, readSharePrivate, saveSharePrivate } from "./repo";
import { validJournal } from "./validate";
import { journalAad, sealJson } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";

// The Together link's "Keep my answers private" ticks: each its own sealed row in the journal
// (`share:<date>:exercise`, `share:<date>:checkin`), never in clear. Made-up dates only.

const DAY = "2026-11-03";

beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.syncMeta.clear(), db.pending.clear()]);
});

it("one sealed row per tick: neither the tick nor its value is in clear", async () => {
  const jk = await keyFor("fake-journal-share");
  await confirmedDevice(db, jk);
  await saveSharePrivate(jk, DAY, "checkin", true);
  const row = (await db.journal.get(`share:${DAY}:checkin`))!;
  expect(row).toMatchObject({ kind: "share", date: DAY, fp: jk.fp });
  expect(Object.keys(row).sort()).toEqual(["ct", "date", "fp", "id", "iv", "kind", "updatedAt"]);
  expect(JSON.stringify({ ...row, id: "", kind: "" })).not.toMatch(/private|true/);
  expect(validJournal(row)).toBe(true);
  expect(await db.journal.get(`share:${DAY}:exercise`)).toBeUndefined();
  expect(await db.pending.get(["journal", row.id])).toBeTruthy(); // it syncs, like every journal row
});

it("ticking both at once never loses one (each its own row, saved one at a time)", async () => {
  const jk = await keyFor("fake-journal-share");
  await confirmedDevice(db, jk);
  await Promise.all([saveSharePrivate(jk, DAY, "exercise", true), saveSharePrivate(jk, DAY, "checkin", true)]);
  expect(await readSharePrivate(jk, DAY)).toEqual({ exercise: true, checkin: true });
  await saveSharePrivate(jk, DAY, "exercise", false);
  expect(await readSharePrivate(jk, DAY)).toEqual({ exercise: false, checkin: true });
  expect([...(await listSharePrivate(jk)).entries()]).toEqual([[DAY, { exercise: false, checkin: true }]]);
});

it("a tick from another device (its own row) never undoes this device's other tick", async () => {
  const jk = await keyFor("fake-journal-share");
  await confirmedDevice(db, jk);
  await saveSharePrivate(jk, DAY, "exercise", true);
  // The other device's check-in tick arrives by sync: a different row, so nothing is written over.
  const id = `share:${DAY}:checkin`;
  await db.journal.put({ id, kind: "share", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, private: true, at: 1 }, journalAad(id))) });
  expect(await readSharePrivate(jk, DAY)).toEqual({ exercise: true, checkin: true });
});

it("a tick this device can't open counts as private (never as shared), and is never written over", async () => {
  const jk = await keyFor("fake-journal-share");
  const other = await keyFor("fake-journal-share-other");
  await confirmedDevice(db, jk);
  const id = `share:${DAY}:exercise`;
  await db.journal.put({ id, kind: "share", date: DAY, fp: other.fp, ...(await sealJson(other.key, { v: 1, private: false, at: 1 }, journalAad(id))) });
  expect(await readSharePrivate(jk, DAY)).toEqual({ exercise: true, checkin: false });
  expect((await listSharePrivate(jk)).get(DAY)).toEqual({ exercise: true, checkin: false });
  await expect(saveSharePrivate(jk, DAY, "exercise", false)).rejects.toThrow();
});

it("the id must be share:<date>:exercise or :checkin", async () => {
  const jk = await keyFor("fake-journal-share");
  const sealed = await sealJson(jk.key, { v: 1, private: true, at: 1 }, journalAad("x"));
  const row = (id: string) => ({ id, kind: "share", date: DAY, fp: jk.fp, ...sealed });
  expect(validJournal(row(`share:${DAY}:exercise`))).toBe(true);
  expect(validJournal(row(`share:${DAY}:checkin`))).toBe(true);
  expect(validJournal(row(`share:${DAY}`))).toBe(false);
  expect(validJournal(row(`share:${DAY}:morning`))).toBe(false);
  expect(validJournal(row(`share:2026-11-04:exercise`))).toBe(false);
});
