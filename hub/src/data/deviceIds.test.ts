// Restore-safe (bug #31): a Replace gives this device a new id for the journal rows it keeps for
// itself; the rows that came back keep their backup stamps and are read, never written again.
// Fictional words only.

import { db } from "./db";
import { exportBackup, restoreBackup } from "./backup";
import { DEVICE_ID_META, FORMER_DEVICE_IDS_META, ownDevices } from "./deviceIds";
import {
  clearNoteDraft, finishMorningPage, listNoteReads, listNotes, moveAnswerOn, readCheckinDay, readMorningDay, saveAnswer, saveMorningDraft,
  saveNote, saveNoteDraft, setNoteRead,
} from "./repo";
import { journalId } from "./validate";
import { journalAad, openJson, type JournalKey } from "../journal/crypto";
import { getDeviceId } from "../sync/engine";
import { confirmedDevice, keyFor } from "../test/journalKey";

const DAY = "2026-11-05";
const NOTE = { prompt: null, thought: "Pretend thought", steady: "Pretend steady words", memory: "", skill: "" };
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-journal-device-ids");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear(), db.items.clear(), db.goals.clear(), db.files.clear()]);
  await confirmedDevice(db, jk);
});

const backup = async () => JSON.parse(JSON.stringify(await exportBackup(DAY)));
const meta = async (key: string) => (await db.syncMeta.get(key))?.value;
const later = () => new Promise((r) => setTimeout(r, 5));

describe("the device id", () => {
  it("Replace makes a new one and keeps the earlier ones as former; Merge keeps it", async () => {
    const first = await getDeviceId(db);
    const file = await backup();
    await restoreBackup(file, "merge");
    expect(await getDeviceId(db)).toBe(first);
    await restoreBackup(file, "replace");
    const second = await getDeviceId(db);
    expect(second).not.toBe(first);
    expect(await meta(FORMER_DEVICE_IDS_META)).toEqual([first]);
    await restoreBackup(file, "replace");
    expect(await meta(FORMER_DEVICE_IDS_META)).toEqual([first, second]);
    expect(await ownDevices(first)).toEqual({ current: await getDeviceId(db), former: [first, second] });
    expect(await ownDevices("another-device-1")).toEqual({ current: "another-device-1", former: [] });
  });

  it("Replace on a device that never had one makes none (no row has one)", async () => {
    await restoreBackup(await backup(), "replace");
    expect(await meta(DEVICE_ID_META)).toBeUndefined();
    expect(await meta(FORMER_DEVICE_IDS_META)).toBeUndefined();
  });
});

describe("after a Replace", () => {
  it("the morning box opens on the restored draft; her typing goes beside it; the restored row keeps its backup stamp", async () => {
    const mac = await getDeviceId(db);
    await saveMorningDraft(jk, DAY, mac, "Pretend first lines.");
    const file = await backup();
    const stamp = (await db.journal.get(journalId("draft", DAY, mac)))!.updatedAt;
    await restoreBackup(file, "replace");
    const now = await getDeviceId(db);
    expect((await readMorningDay(jk, DAY, now)).draft).toBe("Pretend first lines.");
    await saveMorningDraft(jk, DAY, now, "Pretend first lines. More.");
    expect((await db.journal.get(journalId("draft", DAY, mac)))!.updatedAt).toBe(stamp);
    expect((await db.pending.get(["journal", journalId("draft", DAY, mac)]))!.updatedAt).toBe(stamp);
    expect((await readMorningDay(jk, DAY, now)).draft).toBe("Pretend first lines. More.");
    // A page still open with the old id reads and writes the same as the new one.
    expect((await readMorningDay(jk, DAY, mac)).draft).toBe("Pretend first lines. More.");
    await saveMorningDraft(jk, DAY, mac, "Pretend first lines. More. Again.");
    expect((await db.journal.get(journalId("draft", DAY, mac)))!.updatedAt).toBe(stamp);
    expect((await readMorningDay(jk, DAY, now)).draft).toBe("Pretend first lines. More. Again.");
  });

  it("I'm done keeps a former draft with other words as a page once, however many pages follow that day", async () => {
    const mac = await getDeviceId(db);
    await saveMorningDraft(jk, DAY, mac, "Pretend first lines.");
    const file = await backup();
    await saveMorningDraft(jk, DAY, mac, "Pretend newer lines."); // as if it came back from the server
    const newer = await db.journal.get(journalId("draft", DAY, mac));
    await restoreBackup(file, "replace");
    await db.journal.put(newer!); // (the pull would bring it; written here by hand)
    const now = await getDeviceId(db);
    await finishMorningPage(jk, DAY, now, "Pretend page one.");
    await later();
    await finishMorningPage(jk, DAY, now, "Pretend page two.");
    const pages = await Promise.all(
      (await db.journal.where("kind").equals("page").toArray()).map((r) => openJson(jk.key, r, journalAad(r.id)) as Promise<{ text: string }>),
    );
    expect(pages.map((p) => p.text).sort()).toEqual(["Pretend newer lines.", "Pretend page one.", "Pretend page two."]);
    expect((await readMorningDay(jk, DAY, now)).draft).toBe("");
  });

  it("I'm done on a page she typed on from the restored draft adds no extra page", async () => {
    const mac = await getDeviceId(db);
    await saveMorningDraft(jk, DAY, mac, "Pretend first lines.");
    await restoreBackup(await backup(), "replace");
    const now = await getDeviceId(db);
    await saveMorningDraft(jk, DAY, now, "Pretend first lines. And more.");
    await finishMorningPage(jk, DAY, now, "Pretend first lines. And more.");
    expect(await db.journal.where("kind").equals("page").count()).toBe(1);
  });

  it("a restored note in progress is still hers; Cancel lets it go without writing the restored row", async () => {
    const mac = await getDeviceId(db);
    const id = await saveNote(jk, DAY, mac, NOTE);
    await saveNoteDraft(jk, mac, id, { ...NOTE, steady: "Pretend half typed" }, (await listNotes(jk)).notes[0]!.seen);
    await restoreBackup(await backup(), "replace");
    const now = await getDeviceId(db);
    const restored = await db.journal.get(`${id}_${mac}_draft`);
    expect((await listNotes(jk, now)).drafts.map((d) => d.fields.steady)).toEqual(["Pretend half typed"]);
    await clearNoteDraft(jk, now, id);
    expect((await listNotes(jk, now)).drafts).toEqual([]);
    expect(await db.journal.get(`${id}_${mac}_draft`)).toEqual(restored);
  });

  it("the restored \"read today\" ticks show in her box, and a new tick keeps them", async () => {
    const mac = await getDeviceId(db);
    await setNoteRead(jk, DAY, mac, "note:2026-11-01:aaaaaaaaaaaaaaaa", true);
    await restoreBackup(await backup(), "replace");
    const now = await getDeviceId(db);
    expect((await listNoteReads(jk)).ownOn(DAY, now)).toEqual(new Set(["note:2026-11-01:aaaaaaaaaaaaaaaa"]));
    await setNoteRead(jk, DAY, now, "note:2026-11-01:bbbbbbbbbbbbbbbb", true);
    expect((await listNoteReads(jk)).ownOn(DAY, now)).toEqual(new Set(["note:2026-11-01:aaaaaaaaaaaaaaaa", "note:2026-11-01:bbbbbbbbbbbbbbbb"]));
    expect((await listNoteReads(jk)).ownOn(DAY, mac)).toEqual((await listNoteReads(jk)).ownOn(DAY, now));
  });
});

it("device ids that end in \"-e…\" (as a random one can) are told apart from a check-in Edit's rows", async () => {
  const OLD = "aaaaaaaa-aaaa-4aaa-8aaa-e00000000001";
  const NEW = "bbbbbbbb-bbbb-4bbb-8bbb-e00000000002";
  await db.syncMeta.put({ key: DEVICE_ID_META, value: OLD });
  await saveAnswer(jk, DAY, "Pretend question?", OLD, null, false);
  await restoreBackup(await backup(), "replace");
  await db.syncMeta.put({ key: DEVICE_ID_META, value: NEW });
  await moveAnswerOn(jk, DAY, "Pretend question?", NEW, { skip: true });
  expect((await readCheckinDay(jk, DAY)).answers.get("Pretend question?")!.skipped).toBe(true);
});
