// Restore-safe, fix round 1 (review I1, I2): after Replace with an older backup and a change
// made offline, the newer words that sync in afterwards are not only stored, she SEES them:
// - the morning page: today's box opens on them (or "Open that page" offers an earlier day's),
//   even when she had pressed "I'm done" before sync was back;
// - a note in progress: the newer draft shows under the note as another version.
// And a page still open with the old device id writes beside, never over.
// Fictional words only; fake server only.

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { exportBackup, restoreBackup } from "../../data/backup";
import { finishMorningPage, listNotes, readMorningDay, saveMorningDraft, saveNote, saveNoteDraft } from "../../data/repo";
import { journalId } from "../../data/validate";
import type { JournalKey } from "../../journal/crypto";
import { FakeSyncServer } from "../../sync/fakeServer";
import { getDeviceId, saveSyncSettings, stopSyncing, syncOnce } from "../../sync/engine";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";
import { MorningPages } from "./MorningPages";

const TOKEN = "5afe".padEnd(64, "1"); // fake
const SERVER = "https://sync.example.test";
const TODAY = "2026-11-05";
const YESTERDAY = "2026-11-04";
const NOTE = { prompt: null, thought: "Pretend thought", memory: "", skill: "" };
let jk: JournalKey;
let server: FakeSyncServer;
beforeAll(async () => {
  jk = await keyFor("fake-journal-restore-on-screen");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear(), db.items.clear(), db.goals.clear()]);
  server = new FakeSyncServer(TOKEN);
  vi.stubGlobal("fetch", server.fetch); // the app's own sync runs talk to the fake server too
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const later = () => new Promise((r) => setTimeout(r, 5));
const sync = async () => expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");

/** Backup → `newer` (synced) → sync off → Replace → `after` (offline). Sync stays off. */
async function replaced(first: (d: string) => Promise<unknown>, newer: (d: string) => Promise<unknown>, after: (d: string) => Promise<unknown>) {
  await confirmedDevice(db, jk);
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  const mac = await getDeviceId(db);
  await first(mac);
  await sync();
  const backup = JSON.parse(JSON.stringify(await exportBackup(TODAY)));
  await later();
  await newer(mac);
  await sync();
  await stopSyncing(db);
  await restoreBackup(backup, "replace");
  await later();
  await after(await getDeviceId(db));
  return mac;
}
const syncOn = async () => {
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  await sync();
};

describe("I1, morning pages", () => {
  const story = (date: string) =>
    replaced(
      (d) => saveMorningDraft(jk, date, d, "Pretend first lines."),
      (d) => saveMorningDraft(jk, date, d, "Pretend first lines. Pretend newer lines."),
      (d) => finishMorningPage(jk, date, d, "Pretend first lines. Pretend lines after the restore."),
    );

  it("\"I'm done\" offline, then sync: today's box opens on the newer words", async () => {
    await story(TODAY);
    await syncOn();
    renderApp("/journal/morning", TODAY);
    expect(await screen.findByLabelText("Today's morning page")).toHaveValue("Pretend first lines. Pretend newer lines.");
  });

  it("the newer words arrive while the page is open (box empty after \"I'm done\"): they appear in it", async () => {
    await story(TODAY);
    renderApp("/journal/morning", TODAY);
    const box = await screen.findByLabelText("Today's morning page");
    expect(box).toHaveValue("");
    await act(syncOn);
    await waitFor(() => expect(screen.getByLabelText("Today's morning page")).toHaveValue("Pretend first lines. Pretend newer lines."));
  });

  it("an earlier day: \"Open yesterday's page\" offers the newer words, and finishing it settles them", async () => {
    await story(YESTERDAY);
    await syncOn();
    renderApp("/journal/morning", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Open yesterday's page" }));
    expect(screen.getByLabelText("Yesterday's morning page")).toHaveValue("Pretend first lines. Pretend newer lines.");
    await userEvent.click(screen.getByRole("button", { name: "I'm done" }));
    await waitFor(() => expect(screen.queryByLabelText("Yesterday's morning page")).toBeNull());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Open yesterday's page" })).toBeNull());
    expect((await readMorningDay(jk, YESTERDAY, await getDeviceId(db))).draft).toBe("");
  });

  it("a page still open with the old device id: typing saves beside the restored draft, never over it", async () => {
    await confirmedDevice(db, jk);
    const mac = await getDeviceId(db);
    await saveMorningDraft(jk, TODAY, mac, "Pretend first lines.");
    const backup = JSON.parse(JSON.stringify(await exportBackup(TODAY)));
    await restoreBackup(backup, "replace");
    const restored = await db.journal.get(journalId("draft", TODAY, mac));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 5, 12, 0));
    render(<MorningPages jk={jk} today={TODAY} deviceId={mac} />);
    const box = await screen.findByLabelText("Today's morning page");
    expect(box).toHaveValue("Pretend first lines.");
    await userEvent.type(box, " Typed here.");
    box.blur();
    const now = await getDeviceId(db);
    await waitFor(async () => expect((await readMorningDay(jk, TODAY, now)).draft).toBe("Pretend first lines. Typed here."));
    expect(await db.journal.get(journalId("draft", TODAY, mac))).toEqual(restored);
  });
});

describe("I2, a note in progress", () => {
  it("edited and saved offline after the Replace: the newer draft that syncs in shows under the note", async () => {
    let id = "";
    await replaced(
      async (d) => {
        id = await saveNote(jk, TODAY, d, { ...NOTE, steady: "Pretend saved words" });
        await saveNoteDraft(jk, d, id, { ...NOTE, steady: "Pretend draft A" }, (await listNotes(jk)).notes[0]!.seen);
      },
      async (d) => saveNoteDraft(jk, d, id, { ...NOTE, steady: "Pretend draft B newer" }, (await listNotes(jk, d)).drafts[0]!.seen),
      async (d) => {
        const [draft] = (await listNotes(jk, d)).drafts;
        await saveNote(jk, TODAY, d, { ...NOTE, steady: "Pretend A and after" }, { id, seen: draft!.seen });
      },
    );
    await syncOn();
    renderApp("/journal/notes", TODAY);
    const own = await within(await screen.findByRole("region", { name: "Notes to myself" })).findByRole("group", { name: "My own thoughts" });
    expect(await within(own).findByText("Pretend A and after")).toBeInTheDocument();
    expect(await within(own).findByText("Pretend draft B newer")).toBeInTheDocument();
  });
});
