import { vi } from "vitest";
import { db } from "./db";
import { exportBackup, parseBackup, restoreBackup } from "./backup";
import {
  createHighlight, listHighlights, NOT_CONFIRMED, removeHighlight, saveHighlightNote, type HighlightCard,
} from "./repo";
import { journalId, validJournal } from "./validate";
import { journalAad, openJson, sealJson, toBase64, type JournalKey } from "../journal/crypto";
import { JOURNAL_KEY_META } from "../journal/keyStore";
import { describeAnchor } from "../journal/highlights";
import { confirmedDevice, keyFor } from "../test/journalKey";

// Highlights (Esme, 2026-11-06): each version of a highlight is its own sealed row
// `highlight:<date>:<hid>_<deviceId>_<vid>`, written only through the confirmed-key gate; a
// note change is a new version, Remove a tombstone version, and no device writes over another's
// row. Fictional words only.

const DAY = "2026-11-06";
const MAC = "device-mac-0001";
const PHONE = "device-phone-01";
const CARD: HighlightCard = { id: "pretend-1", track: "pretend-book", book: "Pretend DBT book", day: 1, chapter: 1, chapterTitle: "Pretend chapter", theme: "Pretend weather" };
const LEARN = "A made-up note: pretend clouds drift past a pretend hill, and pretend clouds always pass.";
const anchorOf = (words: string, from = 0) => {
  const s = LEARN.indexOf(words, from);
  return describeAnchor("learn", LEARN, s, s + words.length)!;
};
let jk: JournalKey;
let other: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-journal-highlights");
  other = await keyFor("fake-journal-highlights-other");
});

let clock = 1_800_000_000_000;
beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock++);
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear(), db.items.clear(), db.goals.clear(), db.files.clear()]);
  await confirmedDevice(db, jk);
});
afterEach(() => vi.restoreAllMocks());

const rows = () => db.journal.where("kind").equals("highlight").toArray();
const IV16 = toBase64(new Uint8Array(12));
const plain = (o: Record<string, unknown>) => ({ date: DAY, fp: "0123456789abcdef", iv: IV16, ct: "AAAAAAAAAAAAAAAAAAAAAA==", ...o });

describe("row ids and sealing", () => {
  it("highlight:<date>:<16 hex>_<deviceId>_<8 hex> is a valid journal row; other shapes are not", () => {
    const hid = "0123456789abcdef";
    expect(validJournal(plain({ kind: "highlight", id: `highlight:${DAY}:${hid}_${MAC}_0a1b2c3d` }))).toBe(true);
    expect(validJournal(plain({ kind: "highlight", id: `highlight:${DAY}:${hid}_3f2a1b4c-0000-4000-8000-000000000001_0a1b2c3d` }))).toBe(true);
    expect(validJournal(plain({ kind: "highlight", id: `highlight:${DAY}:${hid}` }))).toBe(false);
    expect(validJournal(plain({ kind: "highlight", id: `highlight:2026-11-05:${hid}_${MAC}_0a1b2c3d` }))).toBe(false);
    expect(validJournal(plain({ kind: "highlight", id: `highlight:${DAY}:${hid}_${MAC}_draft` }))).toBe(false);
    expect(validJournal(plain({ kind: "highlight", id: `note:${DAY}:${hid}_${MAC}_0a1b2c3d` }))).toBe(false);
    expect(validJournal(plain({ kind: "highlight", id: `highlight:${DAY}:${hid}_${MAC}_0a1b2c3d`, text: "plaintext by mistake" }))).toBe(false);
  });

  it("a highlight is sealed (nothing of the card or her note in clear) on this device's own row", async () => {
    const hid = await createHighlight(jk, DAY, MAC, CARD, anchorOf("pretend hill"), "Pretend note about the hill");
    expect(hid).toMatch(new RegExp(`^highlight:${DAY}:[0-9a-f]{16}$`));
    const [r] = await rows();
    expect(r!.id).toMatch(new RegExp(`^${hid}_${MAC}_[0-9a-f]{8}$`));
    expect(r!.fp).toBe(jk.fp);
    expect(JSON.stringify(r)).not.toMatch(/Pretend|pretend|hill|weather/);
    const opened = (await openJson(jk.key, r!, journalAad(r!.id))) as { note: string; anchor: { exact: string } };
    expect(opened.note).toBe("Pretend note about the hill");
    expect(opened.anchor.exact).toBe("pretend hill");
    // Like every journal write: it goes out with the next sync.
    expect(await db.pending.where("table").equals("journal").count()).toBeGreaterThan(0);
  });

  it("lists it back: its words, its card, its note", async () => {
    await createHighlight(jk, DAY, MAC, CARD, anchorOf("pretend hill"), "Pretend note");
    const { highlights, unreadable } = await listHighlights(jk);
    expect(unreadable).toBe(0);
    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toMatchObject({ date: DAY, card: CARD, note: "Pretend note", others: [] });
    expect(highlights[0]!.anchor.exact).toBe("pretend hill");
  });

  it("is written only with this device's confirmed key: a stale or unconfirmed key writes nothing", async () => {
    await expect(createHighlight(other, DAY, MAC, CARD, anchorOf("pretend hill"))).rejects.toThrow(NOT_CONFIRMED);
    await db.syncMeta.delete(JOURNAL_KEY_META);
    await expect(createHighlight(jk, DAY, MAC, CARD, anchorOf("pretend hill"))).rejects.toThrow(NOT_CONFIRMED);
    expect(await rows()).toHaveLength(0);
  });

  it("a row this key can't open is counted, skipped on its own, and never written over", async () => {
    await createHighlight(jk, DAY, MAC, CARD, anchorOf("pretend hill"));
    const id = journalId("highlight", DAY, `fedcba9876543210_${PHONE}_00000001`);
    const theirs = { id, kind: "highlight" as const, date: DAY, fp: other.fp, ...(await sealJson(other.key, { v: 1 }, journalAad(id))) };
    await db.journal.put(theirs);
    const { highlights, unreadable } = await listHighlights(jk);
    expect(unreadable).toBe(1);
    expect(highlights).toHaveLength(1);
    expect((await db.journal.get(id))!.ct).toBe(theirs.ct);
  });

  it("a version that opens but isn't a highlight's shape counts as can't open", async () => {
    const id = journalId("highlight", DAY, `fedcba9876543210_${PHONE}_00000001`);
    await db.journal.put({ id, kind: "highlight", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, note: "Pretend" }, journalAad(id))) });
    expect(await listHighlights(jk)).toEqual({ highlights: [], unreadable: 1 });
  });
});

describe("notes and removing", () => {
  it("a note change is a new version: the first row stays as it was", async () => {
    await createHighlight(jk, DAY, MAC, CARD, anchorOf("pretend hill"));
    const first = (await rows())[0]!;
    const [h] = (await listHighlights(jk)).highlights;
    await saveHighlightNote(jk, MAC, h!, "Pretend new note");
    const all = await rows();
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.id === first.id)).toEqual(first);
    expect((await listHighlights(jk)).highlights[0]!.note).toBe("Pretend new note");
  });

  it("one note box session rewrites only its own row, however many saves", async () => {
    await createHighlight(jk, DAY, MAC, CARD, anchorOf("pretend hill"));
    let h = (await listHighlights(jk)).highlights[0]!;
    let session = await saveHighlightNote(jk, MAC, h, "Pretend n");
    h = (await listHighlights(jk)).highlights[0]!;
    session = await saveHighlightNote(jk, MAC, h, "Pretend note", session);
    h = (await listHighlights(jk)).highlights[0]!;
    await saveHighlightNote(jk, MAC, h, "Pretend note, typed on", session);
    expect(await rows()).toHaveLength(2);
    const after = (await listHighlights(jk)).highlights;
    expect(after).toHaveLength(1);
    expect(after[0]!.note).toBe("Pretend note, typed on");
    expect(after[0]!.others).toEqual([]);
  });

  it("remove is a tombstone version: every row stays, the highlight is gone", async () => {
    await createHighlight(jk, DAY, MAC, CARD, anchorOf("pretend hill"), "Pretend note");
    const before = await rows();
    await removeHighlight(jk, MAC, (await listHighlights(jk)).highlights[0]!);
    const after = await rows();
    expect(after).toHaveLength(2);
    for (const r of before) expect(after).toContainEqual(r);
    expect((await listHighlights(jk)).highlights).toEqual([]);
  });

  it("remove, then highlight the same words again: the new one shows; the removed one stays removed", async () => {
    await createHighlight(jk, DAY, MAC, CARD, anchorOf("pretend hill"), "Pretend old note");
    await removeHighlight(jk, MAC, (await listHighlights(jk)).highlights[0]!);
    clock += 1000;
    const again = await createHighlight(jk, DAY, MAC, CARD, anchorOf("pretend hill"));
    const { highlights } = await listHighlights(jk);
    expect(highlights).toHaveLength(1);
    expect(highlights[0]!.hids).toEqual([again]);
    expect(highlights[0]!.note).toBe("");
    expect(highlights[0]!.others).toEqual([]);
  });
});

describe("two devices", () => {
  it("different words: two highlights, newest first; neither device's row is written over", async () => {
    await createHighlight(jk, DAY, MAC, CARD, anchorOf("pretend hill"));
    await createHighlight(jk, DAY, PHONE, CARD, anchorOf("pretend clouds always pass"));
    const { highlights } = await listHighlights(jk);
    expect(highlights.map((h) => h.anchor.exact)).toEqual(["pretend clouds always pass", "pretend hill"]);
    const ids = (await rows()).map((r) => r.id);
    expect(ids.filter((id) => id.includes(`_${MAC}_`))).toHaveLength(1);
    expect(ids.filter((id) => id.includes(`_${PHONE}_`))).toHaveLength(1);
  });

  it("the same words: one highlight as she sees it, both rows kept; Remove takes both", async () => {
    await createHighlight(jk, DAY, MAC, CARD, anchorOf("pretend hill"));
    await createHighlight(jk, DAY, PHONE, CARD, anchorOf("pretend hill"), "Pretend phone note");
    const { highlights } = await listHighlights(jk);
    expect(highlights).toHaveLength(1);
    expect(highlights[0]!.hids).toHaveLength(2);
    expect(highlights[0]!.note).toBe("Pretend phone note");
    await removeHighlight(jk, MAC, highlights[0]!);
    expect((await listHighlights(jk)).highlights).toEqual([]);
    expect(await rows()).toHaveLength(4);
  });

  it("the same words at another place (the second 'pretend clouds') is its own highlight", async () => {
    await createHighlight(jk, DAY, MAC, CARD, anchorOf("pretend clouds"));
    await createHighlight(jk, DAY, PHONE, CARD, anchorOf("pretend clouds", 30));
    expect((await listHighlights(jk)).highlights).toHaveLength(2);
  });

  it("a note edited on two devices without seeing each other: the newest shows, the other is kept under it", async () => {
    await createHighlight(jk, DAY, MAC, CARD, anchorOf("pretend hill"), "Pretend first note");
    const seen = (await listHighlights(jk)).highlights[0]!; // both devices had this in front of them
    await saveHighlightNote(jk, PHONE, seen, "Pretend phone edit");
    await saveHighlightNote(jk, MAC, seen, "Pretend mac edit");
    const [h] = (await listHighlights(jk)).highlights;
    expect(h!.note).toBe("Pretend mac edit");
    expect(h!.others).toEqual(["Pretend phone edit"]);
    expect(await rows()).toHaveLength(3); // nobody's row written over
    // Changing the note shown replaces only that one: the phone's stays until she removes it.
    await saveHighlightNote(jk, MAC, h!, "Pretend mac edit, again");
    const [again] = (await listHighlights(jk)).highlights;
    expect(again!.note).toBe("Pretend mac edit, again");
    expect(again!.others).toEqual(["Pretend phone edit"]);
  });

  it("a remove on one device never takes a note the other wrote that it didn't see", async () => {
    await createHighlight(jk, DAY, MAC, CARD, anchorOf("pretend hill"));
    const seen = (await listHighlights(jk)).highlights[0]!;
    await saveHighlightNote(jk, PHONE, seen, "Pretend note the Mac never saw");
    await removeHighlight(jk, MAC, seen);
    const { highlights } = await listHighlights(jk);
    expect(highlights).toHaveLength(1);
    expect(highlights[0]!.note).toBe("Pretend note the Mac never saw");
  });
});

describe("device ids after a Replace (restore-safe)", () => {
  it("a page still holding a former id writes with the current one; another device's id is used as it is", async () => {
    await db.syncMeta.put({ key: "deviceId", value: "device-new-after-replace" });
    await db.syncMeta.put({ key: "formerDeviceIds", value: [MAC] });
    await createHighlight(jk, DAY, MAC, CARD, anchorOf("pretend hill"));
    await createHighlight(jk, DAY, PHONE, CARD, anchorOf("pretend clouds always pass"));
    const ids = (await rows()).map((r) => r.id);
    expect(ids.some((id) => id.includes(`_${MAC}_`))).toBe(false);
    expect(ids.filter((id) => id.includes("_device-new-after-replace_"))).toHaveLength(1);
    expect(ids.filter((id) => id.includes(`_${PHONE}_`))).toHaveLength(1);
  });
});

describe("backups", () => {
  it("every highlight row (notes and tombstones too) goes into the backup sealed and comes back on restore", async () => {
    await createHighlight(jk, DAY, MAC, CARD, anchorOf("pretend hill"), "Pretend kept note");
    await createHighlight(jk, DAY, PHONE, CARD, anchorOf("pretend clouds always pass"));
    await removeHighlight(jk, MAC, (await listHighlights(jk)).highlights.find((h) => h.anchor.exact === "pretend clouds always pass")!);
    const before = await rows();
    const file = JSON.parse(JSON.stringify(await exportBackup(DAY)));
    expect(file.journal.filter((r: { kind: string }) => r.kind === "highlight")).toHaveLength(3);
    expect(JSON.stringify(file)).not.toMatch(/Pretend|pretend/);
    expect(() => parseBackup(file)).not.toThrow();
    await db.journal.clear();
    await restoreBackup(file, "replace");
    expect((await rows()).map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
    const { highlights } = await listHighlights(jk);
    expect(highlights.map((h) => [h.anchor.exact, h.note])).toEqual([["pretend hill", "Pretend kept note"]]);
  });
});
