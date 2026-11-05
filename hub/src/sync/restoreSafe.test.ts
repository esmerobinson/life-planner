// Bug #31 (restore-safe): after Replace with an OLDER backup, an edit made before sync is back on
// must never write over newer words the server already has, for every journal row one device
// keeps for itself: exercise answers (submitted, draft), exercise marks and stars, check-in
// answers typed in the question flow, the morning-page draft and note "read today" ticks.
// Same shape as TestingV3NoteReplaceThenEdit: backup → newer words (synced, the phone has them)
// → sync off → Replace with the older backup → edit → sync on. Afterwards the newer words are
// on every device, and so is her edit made after the restore.
// Fictional words only; fake server only.

import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import { exportBackup, restoreBackup } from "../data/backup";
import {
  clearNoteDraft, finishMorningPage, latestMorningDraft, listNoteReads, listNotes, moveAnswerOn, readCheckinDay, readExerciseEntry,
  readExerciseProgress, readMorningDay, saveAnswer, saveExerciseDraft, saveExerciseEdit, saveExerciseMark, saveMorningDraft, saveNote,
  saveNoteDraft, setExerciseStar, setNoteRead, submitExerciseEntry,
} from "../data/repo";
import type { JournalKind, JournalRow } from "../domain/types";
import { journalAad, openJson, type JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { FakeSyncServer } from "./fakeServer";
import { getDeviceId, saveSyncSettings, stopSyncing, syncOnce } from "./engine";

const TOKEN = "5afe".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const DAY = "2026-11-05";
const CARD = { id: "pretend-card-1", day: 1, theme: "Pretend theme", legacy: false };
const PROMPT = "Pretend question?";
let jk: JournalKey;
const open: HubDB[] = [];
beforeAll(async () => {
  jk = await keyFor("fake-journal-restore-safe");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear(), db.items.clear(), db.goals.clear(), db.files.clear()]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

const later = () => new Promise((r) => setTimeout(r, 5));
const ok = async (d: HubDB, server: FakeSyncServer) => expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("ok");

/** Every row of `kind` on a device, opened (any device's, any version). */
async function opened(d: HubDB, kind: JournalKind): Promise<unknown[]> {
  const rows = (await d.journal.where("kind").equals(kind).toArray()) as JournalRow[];
  return Promise.all(rows.map((r) => openJson(jk.key, r, journalAad(r.id))));
}
const words = async (d: HubDB, kind: JournalKind) => JSON.stringify(await opened(d, kind));

interface Steps {
  /** What the backup holds. */
  first: (device: string) => Promise<void>;
  /** Newer words written after the backup (synced: the phone has them). */
  newer: (device: string) => Promise<void>;
  /** Her change after the Replace, before sync is back on (`device`: the id the journal page reads now). */
  after?: (device: string, before: string) => Promise<void>;
}

/** The whole story on the Mac (the default db) and a phone. Returns the phone and the server. */
async function replaceThenEdit(s: Steps) {
  const server = new FakeSyncServer(TOKEN);
  await confirmedDevice(db, jk);
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  const mac = await getDeviceId(db);
  await s.first(mac);
  await ok(db, server);
  const backup = JSON.parse(JSON.stringify(await exportBackup(DAY)));
  await later();
  await s.newer(mac);
  await ok(db, server);
  const phone = new HubDB(`restore-safe-phone-${Math.random()}`);
  open.push(phone);
  await saveSyncSettings(phone, { serverUrl: SERVER, token: TOKEN });
  await ok(phone, server);

  await stopSyncing(db);
  await restoreBackup(backup, "replace");
  await later();
  if (s.after) await s.after(await getDeviceId(db), mac);
  await later();
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  await ok(db, server);
  await ok(phone, server);
  await ok(db, server);
  return { phone, server, mac };
}

describe("Replace an older backup, change it before syncing, sync on: the newer words and her change are both kept on every device", () => {
  it("an exercise answer she submitted", async () => {
    const { phone } = await replaceThenEdit({
      first: (d) => submitExerciseEntry(jk, DAY, d, CARD, "Pretend first answer"),
      newer: (d) => submitExerciseEntry(jk, DAY, d, CARD, "Pretend newer answer"),
      after: (d) => submitExerciseEntry(jk, DAY, d, CARD, "Pretend answer after the restore"),
    });
    for (const d of [db, phone]) {
      expect(await words(d, "exercise-entry")).toContain("Pretend newer answer");
      expect(await words(d, "exercise-entry")).toContain("Pretend answer after the restore");
    }
    const { entry } = await readExerciseEntry(jk, DAY, CARD, await getDeviceId(db));
    expect(entry!.text).toBe("Pretend answer after the restore");
    expect(entry!.others.map((o) => o.text)).toContain("Pretend newer answer");
  });

  it("an exercise answer she was still typing (the draft)", async () => {
    const { phone } = await replaceThenEdit({
      first: (d) => saveExerciseDraft(jk, DAY, d, CARD, "Pretend first draft"),
      newer: (d) => saveExerciseDraft(jk, DAY, d, CARD, "Pretend newer draft"),
      after: (d) => saveExerciseDraft(jk, DAY, d, CARD, "Pretend draft after the restore"),
    });
    for (const d of [db, phone]) {
      expect(await words(d, "exercise-entry")).toContain("Pretend newer draft");
      expect(await words(d, "exercise-entry")).toContain("Pretend draft after the restore");
    }
    const { entry } = await readExerciseEntry(jk, DAY, CARD, await getDeviceId(db));
    expect(entry!.text).toBe("Pretend draft after the restore");
    expect(entry!.others.map((o) => o.text)).toContain("Pretend newer draft");
  });

  it("exercise marks (cards done that day)", async () => {
    const { phone } = await replaceThenEdit({
      first: (d) => saveExerciseMark(jk, DAY, d, "pretend-a", true),
      newer: (d) => saveExerciseMark(jk, DAY, d, "pretend-b", true),
      after: (d) => saveExerciseMark(jk, DAY, d, "pretend-c", true),
    });
    for (const d of [db, phone]) {
      const all = await words(d, "exercise");
      for (const card of ["pretend-a", "pretend-b", "pretend-c"]) expect(all).toContain(card);
    }
    const done = new Set((await readExerciseProgress(jk)).marks.filter((m) => m.done).map((m) => m.id));
    expect(done).toEqual(new Set(["pretend-a", "pretend-b", "pretend-c"]));
  });

  it("exercise stars", async () => {
    const { phone } = await replaceThenEdit({
      first: (d) => setExerciseStar(jk, DAY, d, "pretend-a", true),
      newer: (d) => setExerciseStar(jk, DAY, d, "pretend-b", true),
      after: (d) => setExerciseStar(jk, DAY, d, "pretend-c", true),
    });
    for (const d of [db, phone]) {
      const all = await words(d, "stars");
      for (const card of ["pretend-a", "pretend-b", "pretend-c"]) expect(all).toContain(card);
    }
    expect((await readExerciseProgress(jk)).starred).toEqual(new Set(["pretend-a", "pretend-b", "pretend-c"]));
  });

  it("a check-in answer typed in the question flow", async () => {
    const { phone } = await replaceThenEdit({
      first: (d) => saveAnswer(jk, DAY, PROMPT, d, "Pretend first answer", false),
      newer: (d) => saveAnswer(jk, DAY, PROMPT, d, "Pretend newer answer", false),
      after: (d) => saveAnswer(jk, DAY, PROMPT, d, "Pretend answer after the restore", false),
    });
    for (const d of [db, phone]) {
      expect(await words(d, "answer")).toContain("Pretend newer answer");
      expect(await words(d, "answer")).toContain("Pretend answer after the restore");
    }
    expect((await readCheckinDay(jk, DAY)).answers.get(PROMPT)!.answer).toBe("Pretend answer after the restore");
  });

  it("the morning-page draft; and I'm done keeps the newer draft as a page of its own", async () => {
    const { phone } = await replaceThenEdit({
      first: (d) => saveMorningDraft(jk, DAY, d, "Pretend first lines."),
      newer: (d) => saveMorningDraft(jk, DAY, d, "Pretend first lines. Pretend newer lines."),
      after: (d) => saveMorningDraft(jk, DAY, d, "Pretend first lines. Pretend lines after the restore."),
    });
    for (const d of [db, phone]) {
      expect(await words(d, "draft")).toContain("Pretend newer lines.");
      expect(await words(d, "draft")).toContain("Pretend lines after the restore.");
    }
    const me = await getDeviceId(db);
    expect((await readMorningDay(jk, DAY, me)).draft).toBe("Pretend first lines. Pretend lines after the restore.");
    await finishMorningPage(jk, DAY, me, "Pretend first lines. Pretend lines after the restore.");
    const pages = JSON.stringify(await opened(db, "page"));
    expect(pages).toContain("Pretend lines after the restore.");
    expect(pages).toContain("Pretend newer lines.");
    expect((await readMorningDay(jk, DAY, me)).draft).toBe("");
  });

  it("note \"read today\" ticks", async () => {
    const { phone } = await replaceThenEdit({
      first: (d) => setNoteRead(jk, DAY, d, "note:2026-11-01:aaaaaaaaaaaaaaaa", true),
      newer: (d) => setNoteRead(jk, DAY, d, "note:2026-11-01:bbbbbbbbbbbbbbbb", true),
      after: (d) => setNoteRead(jk, DAY, d, "note:2026-11-01:cccccccccccccccc", true),
    });
    for (const d of [db, phone]) {
      const all = await words(d, "note-read");
      for (const n of ["aaaa", "bbbb", "cccc"]) expect(all).toContain(n);
    }
    expect([...(await listNoteReads(jk)).readOn(DAY)].sort()).toEqual([
      "note:2026-11-01:aaaaaaaaaaaaaaaa", "note:2026-11-01:bbbbbbbbbbbbbbbb", "note:2026-11-01:cccccccccccccccc",
    ]);
  });
});

describe("around it", () => {
  it("a journal page left open from before the Replace (it still has the old device id) writes beside, never over", async () => {
    const { phone } = await replaceThenEdit({
      first: (d) => saveAnswer(jk, DAY, PROMPT, d, "Pretend first answer", false),
      newer: (d) => saveAnswer(jk, DAY, PROMPT, d, "Pretend newer answer", false),
      after: (_now, before) => saveAnswer(jk, DAY, PROMPT, before, "Pretend answer from the open page", false),
    });
    for (const d of [db, phone]) {
      expect(await words(d, "answer")).toContain("Pretend newer answer");
      expect(await words(d, "answer")).toContain("Pretend answer from the open page");
    }
  });

  it("offline for a long time after the Replace: many changes on many days, then sync: nothing is lost", async () => {
    const { phone } = await replaceThenEdit({
      first: async (d) => {
        await saveMorningDraft(jk, DAY, d, "Pretend first lines.");
        await saveAnswer(jk, DAY, PROMPT, d, "Pretend first answer", false);
      },
      newer: async (d) => {
        await saveMorningDraft(jk, DAY, d, "Pretend newer lines.");
        await saveAnswer(jk, DAY, PROMPT, d, "Pretend newer answer", false);
      },
      after: async (d) => {
        for (let i = 0; i < 5; i++) {
          await saveMorningDraft(jk, DAY, d, `Pretend offline lines ${i}.`);
          await saveAnswer(jk, DAY, PROMPT, d, `Pretend offline answer ${i}`, false);
          await saveMorningDraft(jk, "2026-11-06", d, `Pretend next day lines ${i}.`);
          await later();
        }
        await moveAnswerOn(jk, DAY, PROMPT, d);
      },
    });
    for (const d of [db, phone]) {
      expect(await words(d, "draft")).toContain("Pretend newer lines.");
      expect(await words(d, "draft")).toContain("Pretend offline lines 4.");
      expect(await words(d, "draft")).toContain("Pretend next day lines 4.");
      expect(await words(d, "answer")).toContain("Pretend newer answer");
      expect(await words(d, "answer")).toContain("Pretend offline answer 4");
    }
    const a = (await readCheckinDay(jk, DAY)).answers.get(PROMPT)!;
    expect(a).toMatchObject({ answer: "Pretend offline answer 4", done: true });
  });

  it("Replace and no changes: once synced, every device has the newer words again, and nothing else changed", async () => {
    const { phone, server } = await replaceThenEdit({
      first: async (d) => {
        await saveMorningDraft(jk, DAY, d, "Pretend first lines.");
        await submitExerciseEntry(jk, DAY, d, CARD, "Pretend first answer");
      },
      newer: async (d) => {
        await saveMorningDraft(jk, DAY, d, "Pretend newer lines.");
        await submitExerciseEntry(jk, DAY, d, CARD, "Pretend newer answer");
      },
    });
    const ids = async (d: HubDB) => (await d.journal.toCollection().primaryKeys()).sort();
    expect(await ids(db)).toEqual(await ids(phone));
    expect(await words(db, "draft")).toBe(JSON.stringify([{ v: 1, text: "Pretend newer lines." }]));
    expect(await words(phone, "draft")).toBe(JSON.stringify([{ v: 1, text: "Pretend newer lines." }]));
    const { entry } = await readExerciseEntry(jk, DAY, CARD, await getDeviceId(db));
    expect(entry!.text).toBe("Pretend newer answer");
    expect(entry!.others).toEqual([]);
    expect(await db.pending.count()).toBe(0);
    // The server's rows are the ones it had before the Replace (none came back older).
    expect(server.rows.size).toBe((await db.journal.count()));
    expect((await readMorningDay(jk, DAY, await getDeviceId(db))).draft).toBe("Pretend newer lines.");
  });

  it("no restore: an edit writes over this device's own row as always (one row, the newest words)", async () => {
    const server = new FakeSyncServer(TOKEN);
    await confirmedDevice(db, jk);
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    const mac = await getDeviceId(db);
    await saveMorningDraft(jk, DAY, mac, "Pretend first lines.");
    await ok(db, server);
    await later();
    await saveMorningDraft(jk, DAY, mac, "Pretend newer lines.");
    await saveMorningDraft(jk, DAY, mac, "Pretend newest lines.");
    await ok(db, server);
    expect(await getDeviceId(db)).toBe(mac);
    expect(await db.journal.where("kind").equals("draft").primaryKeys()).toEqual([`draft:${DAY}:${mac}`]);
    expect(await words(db, "draft")).toBe(JSON.stringify([{ v: 1, text: "Pretend newest lines." }]));
    expect((await readMorningDay(jk, DAY, mac)).draft).toBe("Pretend newest lines.");
  });

  it("Merge an older backup (sync off), change it, sync on: the newer words are kept too", async () => {
    const server = new FakeSyncServer(TOKEN);
    await confirmedDevice(db, jk);
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    const mac = await getDeviceId(db);
    await saveAnswer(jk, DAY, PROMPT, mac, "Pretend first answer", false);
    await ok(db, server);
    const backup = JSON.parse(JSON.stringify(await exportBackup(DAY)));
    await later();
    await saveAnswer(jk, DAY, PROMPT, mac, "Pretend newer answer", false);
    await ok(db, server);
    await stopSyncing(db);
    await restoreBackup(backup, "merge");
    await later();
    await saveAnswer(jk, DAY, PROMPT, await getDeviceId(db), "Pretend answer after the merge", false);
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    await ok(db, server);
    // Merge only adds what is missing: her newer answer was here all along, and her change is newest.
    expect((await readCheckinDay(jk, DAY)).answers.get(PROMPT)!.answer).toBe("Pretend answer after the merge");
  });
});

describe("fix round 1: the newer words are not only kept, she can find them on screen", () => {
  const YESTERDAY = "2026-11-04";
  const NOTE = { prompt: null, thought: "Pretend thought", memory: "", skill: "" };

  it("I1: \"I'm done\" while still offline, then the newer draft syncs in: today's box opens on it", async () => {
    await replaceThenEdit({
      first: (d) => saveMorningDraft(jk, DAY, d, "Pretend first lines."),
      newer: (d) => saveMorningDraft(jk, DAY, d, "Pretend first lines. Pretend newer lines."),
      after: async (d) => {
        expect((await readMorningDay(jk, DAY, d)).draft).toBe("Pretend first lines.");
        await finishMorningPage(jk, DAY, d, "Pretend first lines. Pretend lines after the restore.");
        expect((await readMorningDay(jk, DAY, d)).draft).toBe("");
      },
    });
    const me = await getDeviceId(db);
    const day = await readMorningDay(jk, DAY, me);
    expect(day.draft).toBe("Pretend first lines. Pretend newer lines.");
    // She finishes it from the box: it is a page, and the box is empty again for good.
    await saveMorningDraft(jk, DAY, me, `${day.draft} More.`, day.draftFrom);
    await finishMorningPage(jk, DAY, me, `${day.draft} More.`);
    expect(JSON.stringify(await opened(db, "page"))).toContain("Pretend newer lines. More.");
    expect((await readMorningDay(jk, DAY, me)).draft).toBe("");
  });

  it("I1, an earlier day: the newer draft is offered with \"Open that page\", and finishing it there settles it", async () => {
    await replaceThenEdit({
      first: (d) => saveMorningDraft(jk, YESTERDAY, d, "Pretend first lines."),
      newer: (d) => saveMorningDraft(jk, YESTERDAY, d, "Pretend first lines. Pretend newer lines."),
      after: async (d) => void (await finishMorningPage(jk, YESTERDAY, d, "Pretend first lines. Pretend lines after the restore.")),
    });
    const me = await getDeviceId(db);
    const offer = await latestMorningDraft(jk, DAY, me);
    expect(offer).toMatchObject({ date: YESTERDAY, text: "Pretend first lines. Pretend newer lines." });
    await saveMorningDraft(jk, YESTERDAY, me, offer!.text, offer!.from);
    await finishMorningPage(jk, YESTERDAY, me, offer!.text);
    expect(await latestMorningDraft(jk, DAY, me)).toBeNull();
    expect(JSON.stringify(await opened(db, "page"))).toContain("Pretend newer lines.");
  });

  it("I1: she clears the restored draft to start again: it doesn't come back", async () => {
    await confirmedDevice(db, jk);
    const mac = await getDeviceId(db);
    await saveMorningDraft(jk, DAY, mac, "Pretend first lines.");
    const backup = JSON.parse(JSON.stringify(await exportBackup(DAY)));
    await restoreBackup(backup, "replace");
    const me = await getDeviceId(db);
    const day = await readMorningDay(jk, DAY, me);
    await saveMorningDraft(jk, DAY, me, "", day.draftFrom);
    expect((await readMorningDay(jk, DAY, me)).draft).toBe("");
  });

  /** A note in progress A (in the backup), then B (synced), Replace, then `after` offline, sync on. */
  async function noteStory(after: (device: string, id: string) => Promise<void>, saved = true) {
    let id = "";
    const story = await replaceThenEdit({
      first: async (d) => {
        id = saved ? await saveNote(jk, DAY, d, { ...NOTE, steady: "Pretend saved words" }) : `note:${DAY}:0123456789abcdef`;
        const seen = saved ? (await listNotes(jk)).notes[0]!.seen : [];
        await saveNoteDraft(jk, d, id, { ...NOTE, steady: "Pretend draft A" }, seen);
      },
      newer: async (d) => {
        const [draft] = (await listNotes(jk, d)).drafts;
        await saveNoteDraft(jk, d, id, { ...NOTE, steady: "Pretend draft B newer" }, draft!.seen);
      },
      after: (d) => after(d, id),
    });
    return { ...story, id };
  }
  /** Every word of a note she can reach in the list: shown, other versions, her draft. */
  async function reachable(device: string) {
    const { notes, drafts } = await listNotes(jk, device);
    return JSON.stringify({ notes: notes.map((n) => [n.steady, ...n.others.map((o) => o.steady)]), drafts: drafts.map((d) => d.fields.steady) });
  }

  it("I2: she changes the restored note in progress and saves it offline; the newer draft that syncs in shows as another version", async () => {
    const { id } = await noteStory(async (d, noteId) => {
      const [draft] = (await listNotes(jk, d)).drafts;
      expect(draft!.fields.steady).toBe("Pretend draft A");
      await saveNoteDraft(jk, d, noteId, { ...NOTE, steady: "Pretend draft A and after" }, draft!.seen);
      await saveNote(jk, DAY, d, { ...NOTE, steady: "Pretend draft A and after" }, { id: noteId, seen: draft!.seen });
    });
    const me = await getDeviceId(db);
    const note = (await listNotes(jk, me)).notes.find((n) => n.id === id)!;
    expect(note.steady).toBe("Pretend draft A and after");
    expect(note.others.map((o) => o.steady)).toContain("Pretend draft B newer");
    // She lets that version go on purpose: then it's gone (a delete row names it).
    const other = note.others.find((o) => o.steady === "Pretend draft B newer")!;
    const { deleteNote } = await import("../data/repo");
    await deleteNote(jk, me, id, [other.vid]);
    expect(await reachable(me)).not.toContain("Pretend draft B newer");
    expect(await reachable(me)).toContain("Pretend draft A and after");
  });

  it("I2: she cancels the restored note in progress offline; the newer draft that syncs in is her draft again", async () => {
    await noteStory(async (d, noteId) => {
      const [draft] = (await listNotes(jk, d)).drafts;
      await saveNoteDraft(jk, d, noteId, { ...NOTE, steady: "Pretend draft A typed on" }, draft!.seen);
      await clearNoteDraft(jk, d, noteId, draft!.seen);
      expect((await listNotes(jk, d)).drafts).toEqual([]);
    });
    expect(await reachable(await getDeviceId(db))).toContain("Pretend draft B newer");
  });

  it("I2: a new note never saved: she edits the restored draft offline; the newer one shows too", async () => {
    await noteStory(async (d, noteId) => {
      const [draft] = (await listNotes(jk, d)).drafts;
      await saveNoteDraft(jk, d, noteId, { ...NOTE, steady: "Pretend draft A typed on" }, draft!.seen);
    }, false);
    const words = await reachable(await getDeviceId(db));
    expect(words).toContain("Pretend draft A typed on");
    expect(words).toContain("Pretend draft B newer");
  });

  it("I2: no edit after the Replace: the newer draft is simply her draft", async () => {
    await noteStory(async () => undefined);
    const me = await getDeviceId(db);
    expect((await listNotes(jk, me)).drafts.map((d) => d.fields.steady)).toEqual(["Pretend draft B newer"]);
    expect(JSON.stringify((await listNotes(jk, me)).notes.map((n) => n.others))).toBe("[[]]");
  });

  it("check-in Edit, Skip and an exercise Edit after the Replace write beside, never over", async () => {
    const { phone } = await replaceThenEdit({
      first: async (d) => {
        await saveAnswer(jk, DAY, PROMPT, d, "Pretend first answer", true);
        await submitExerciseEntry(jk, DAY, d, CARD, "Pretend first exercise");
      },
      newer: async (d) => {
        await saveAnswer(jk, DAY, PROMPT, d, "Pretend newer answer", true);
        await saveAnswer(jk, DAY, "Pretend second question?", d, "Pretend second newer", false);
        await submitExerciseEntry(jk, DAY, d, CARD, "Pretend newer exercise");
      },
      after: async (d) => {
        await saveAnswer(jk, DAY, PROMPT, d, "Pretend edited answer", true, { session: "s1" });
        await moveAnswerOn(jk, DAY, "Pretend second question?", d, { skip: true });
        await saveExerciseEdit(jk, DAY, d, CARD, "Pretend edited exercise");
      },
    });
    for (const d of [db, phone]) {
      for (const w of ["Pretend newer answer", "Pretend second newer", "Pretend edited answer"]) expect(await words(d, "answer")).toContain(w);
      expect(await words(d, "exercise-entry")).toContain("Pretend newer exercise");
      expect(await words(d, "exercise-entry")).toContain("Pretend edited exercise");
    }
    const day = await readCheckinDay(jk, DAY);
    expect(day.answers.get("Pretend second question?")!.answer).toBe("Pretend second newer");
  });

  it("two Replaces, each followed by a change offline, then sync: every version is kept, the box shows the last", async () => {
    const server = new FakeSyncServer(TOKEN);
    await confirmedDevice(db, jk);
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    await saveMorningDraft(jk, DAY, await getDeviceId(db), "Pretend first lines.");
    await ok(db, server);
    const backup = JSON.parse(JSON.stringify(await exportBackup(DAY)));
    await later();
    await saveMorningDraft(jk, DAY, await getDeviceId(db), "Pretend newer lines.");
    await ok(db, server);
    await stopSyncing(db);
    for (const n of [1, 2]) {
      await restoreBackup(backup, "replace");
      await later();
      await saveMorningDraft(jk, DAY, await getDeviceId(db), `Pretend lines after restore ${n}.`);
      await later();
    }
    await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
    await ok(db, server);
    const all = await words(db, "draft");
    for (const w of ["Pretend newer lines.", "Pretend lines after restore 2."]) expect(all).toContain(w);
    expect((await readMorningDay(jk, DAY, await getDeviceId(db))).draft).toBe("Pretend lines after restore 2.");
  });
});
