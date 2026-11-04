import { vi } from "vitest";
import { db } from "../data/db";
import { ensureCheckinSet, finishMorningPage, saveAnswer, saveExerciseDraft, submitExerciseEntry } from "../data/repo";
import type { JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { loadJournalDocs } from "./journalSearch";
import { searchJournal } from "./search";

// Journal results for ⌘K search: opened with the confirmed key, in memory only. Morning pages
// under 28 days old are never opened. Fictional words only.
const TODAY = "2026-11-04";
const ME = "device-mac-0001";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-journal-search");
});

let clock = 1_800_000_000_000;
beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock++);
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
});
afterEach(() => vi.restoreAllMocks());

describe("loadJournalDocs", () => {
  it("opens check-in answers (with their question), exercise responses and old morning pages; never a page under 28 days old", async () => {
    await ensureCheckinSet(jk, "2026-10-22", ["M10"]);
    await saveAnswer(jk, "2026-10-22", "M10", ME, "The pretend market was crowded; paced breathing helped", true);
    const card = { id: "day-38", day: 38, theme: "Imaginary pebbles", legacy: true };
    await submitExerciseEntry(jk, "2026-10-19", ME, card, "Left the pretend market early and that was okay");
    await saveExerciseDraft(jk, TODAY, ME, { id: "day-39", day: 39, theme: "Imaginary shells", legacy: true }, "A pretend draft about the market");
    await finishMorningPage(jk, "2026-10-02", ME, "The pretend market dream again"); // 33 days old: searchable
    await finishMorningPage(jk, "2026-10-29", ME, "A secret pretend market page"); // 6 days old: never

    const docs = await loadJournalDocs(jk, TODAY);
    expect(docs.map((d) => d.kind).sort()).toEqual(["checkin", "exercise", "exercise", "morning"]);
    expect(docs.find((d) => d.kind === "checkin")).toMatchObject({ date: "2026-10-22", title: "Daily check-in" });
    expect(docs.find((d) => d.kind === "checkin")!.context).toMatch(/feeling/);
    expect(docs.find((d) => d.kind === "morning")).toMatchObject({ date: "2026-10-02", text: "The pretend market dream again" });
    expect(docs.some((d) => d.text.includes("secret"))).toBe(false);
    expect(docs.find((d) => d.date === "2026-10-19")!.title).toBe("Mental health exercise · Day 38");

    const hits = searchJournal(docs, "market", TODAY);
    expect(hits.map((h) => h.meta)).toEqual(["Wed 4 Nov", "Thu 22 Oct", "Mon 19 Oct", "Fri 2 Oct"]);
  });

  it("the 28-day line: a page dated 28 days back opens, 27 days back never does", async () => {
    await finishMorningPage(jk, "2026-10-07", ME, "Pretend page twenty-eight days old"); // opens on 11-04
    await finishMorningPage(jk, "2026-10-08", ME, "Pretend page twenty-seven days old"); // opens on 11-05
    const docs = await loadJournalDocs(jk, TODAY);
    expect(docs.map((d) => d.date)).toEqual(["2026-10-07"]);
  });

  it("before 3am the shell's day is still yesterday: a page that opens today stays locked", async () => {
    await finishMorningPage(jk, "2026-10-07", ME, "Pretend page");
    expect(await loadJournalDocs(jk, "2026-11-03")).toEqual([]);
  });

  it("a locked page is never even decrypted", async () => {
    await finishMorningPage(jk, "2026-10-30", ME, "A pretend page that must stay sealed");
    await finishMorningPage(jk, "2026-10-08", ME, "Another pretend sealed page");
    const decrypt = vi.spyOn(crypto.subtle, "decrypt");
    const docs = await loadJournalDocs(jk, TODAY);
    expect(docs).toEqual([]);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("stops opening entries once the search closes (aborted)", async () => {
    await ensureCheckinSet(jk, "2026-10-22", ["M10"]);
    await saveAnswer(jk, "2026-10-22", "M10", ME, "Pretend answer", true);
    await finishMorningPage(jk, "2026-10-01", ME, "Pretend old page");
    const stop = new AbortController();
    stop.abort();
    const decrypt = vi.spyOn(crypto.subtle, "decrypt");
    await expect(loadJournalDocs(jk, TODAY, stop.signal)).rejects.toThrow();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("writes nothing while loading (no index on disk)", async () => {
    await ensureCheckinSet(jk, "2026-10-22", ["M10"]);
    await saveAnswer(jk, "2026-10-22", "M10", ME, "Pretend answer", true);
    const before = { journal: await db.journal.count(), meta: await db.syncMeta.count(), pending: await db.pending.count() };
    await loadJournalDocs(jk, TODAY);
    expect({ journal: await db.journal.count(), meta: await db.syncMeta.count(), pending: await db.pending.count() }).toEqual(before);
  });
});
