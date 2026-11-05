// Testing session (farm x journal): sticker moments earned in the Journal are HELD while she is
// on /journal (no pop-up, nothing takes focus or covers the box she types in), arrive once she
// leaves, are never lost if she closes the app still in the Journal, and are never earned twice
// (Edit / re-save, a reload). What Esme would see if these failed: the farm interrupting her
// journal, or a sticker she earned never turning up (or turning up twice). Fictional words only.
// The same in a real browser (WebKit and Chrome): e2e/testing-farm-held-queue.spec.ts.

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { ensureCheckinSet } from "../data/repo";
import type { JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { renderApp } from "../test/renderApp";
import { seenRow, startRow } from "./state";

const TODAY = "2026-10-28";
const WORDS = ["Pretend: a teapot and a cloud", "Pretend: I asked a made-up friend", "Pretend: a warm bath"];
/** More than the farm's 2 s journal re-read, so the journal's stickers are counted by then. */
const SETTLE = 3000;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-farm-journal-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.items.clear(), db.farm.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
  // The farm started yesterday and Welcome was seen: only what she does now is new.
  await db.farm.bulkPut([startRow("devicePretend01", "2026-10-27"), seenRow("hi", "2026-10-27")]);
});
afterEach(async () => {
  cleanup();
  await pause(150);
  vi.useRealTimers();
});

const nook = () => document.querySelector(".farm-nook")!;
const news = () => document.querySelector(".farm-nook-news")!;
const leaveJournal = async () =>
  userEvent.click(within(document.querySelector("nav[aria-label='Main']") as HTMLElement).getByRole("link", { name: "Goals" }));
const seenIds = async () => (await db.farm.where("kind").equals("seen").toArray()).map((r) => r.id).sort();

/**
 * Every one of `keys` is kept (seen). In the test DOM a burst of moments in one session can skip
 * one (testingNookQueue.test.tsx; not seen in WebKit or Chrome), so this allows "next time she
 * opens the app" too, which is the promise: never lost.
 */
async function allArrive(keys: string[]) {
  for (let open = 0; open < 4; open++) {
    try {
      await waitFor(async () => expect(await seenIds()).toEqual(expect.arrayContaining(keys.map((k) => `seen:${k}`))), { timeout: 4000 });
      return;
    } catch {
      cleanup();
      renderApp("/goals", TODAY);
    }
  }
  expect(await seenIds()).toEqual(expect.arrayContaining(keys.map((k) => `seen:${k}`)));
}

async function finishCheckIn() {
  await ensureCheckinSet(jk, TODAY, ["M1", "D3", "K2"]);
  const s = await screen.findByRole("region", { name: "Daily check-in" });
  for (let i = 0; i < WORDS.length; i++) {
    await within(s).findByRole("img", { name: `Question ${i + 1} of ${WORDS.length}` });
    const box = within(s).getByLabelText("Your answer");
    await userEvent.type(box, WORDS[i]!);
    expect(document.activeElement).toBe(box); // nothing took focus while she typed
    await userEvent.click(within(s).getByRole("button", { name: i === WORDS.length - 1 ? "Finish" : "Next →" }));
  }
  expect(await within(s).findByText("Checked in for today")).toBeInTheDocument();
  return s;
}

describe("held on the Journal", () => {
  it("finishing a check-in: no moment while still in the Journal; the lily pad arrives once she leaves", async () => {
    renderApp("/journal/check-in", TODAY);
    await finishCheckIn();
    await pause(SETTLE);
    expect(await db.farm.get("seen:lilypad")).toBeUndefined();
    expect(nook()).not.toHaveAttribute("data-pose", "happy");
    expect(news()).toHaveTextContent("");
    expect(screen.queryByRole("dialog")).toBeNull();
    await leaveJournal();
    // Counted already (no new journal read is needed): it arrives straight away.
    await waitFor(async () => expect(await db.farm.get("seen:lilypad")).toBeTruthy(), { timeout: 1500 });
  }, 20_000);

  it("I'm done on morning pages, while a to-do sticker also comes in: nothing plays or takes the box's focus until she leaves", async () => {
    renderApp("/journal/morning", TODAY);
    const box = await screen.findByLabelText("Today's morning page");
    await userEvent.type(box, "Pretend morning words about a lighthouse");
    // A Mind to-do ticked on the other device syncs in while she is typing.
    await db.items.put({
      id: "t1", kind: "task", title: "Pretend task", links: [], areaId: "mind", priority: 2, status: "done",
      completedAt: "2026-10-27", createdAt: "2026-10-01", touchedAt: "2026-10-27",
    });
    await pause(1000);
    expect(document.activeElement).toBe(box);
    expect((box as HTMLTextAreaElement).value).toBe("Pretend morning words about a lighthouse");
    expect(nook()).not.toHaveAttribute("data-pose", "happy");
    await userEvent.click(screen.getByRole("button", { name: "I'm done" }));
    await pause(SETTLE);
    expect(await seenIds()).toEqual(["seen:hi"]);
    expect(news()).toHaveTextContent("");
    await leaveJournal();
    await allArrive(["seeds-mind", "seedtray", "feather"]);
  }, 40_000);

  it("closing the app while still in the Journal loses nothing: it waits if the app opens on the Journal again, and arrives once she leaves", async () => {
    renderApp("/journal/check-in", TODAY);
    await finishCheckIn();
    await pause(SETTLE);
    cleanup(); // she closes the app, still on the Journal
    renderApp("/journal", TODAY); // next time it opens on the Journal
    await screen.findByRole("heading", { level: 1, name: "Journal" });
    await pause(SETTLE);
    expect(await db.farm.get("seen:lilypad")).toBeUndefined();
    cleanup();
    renderApp("/today", TODAY); // and then somewhere else
    await waitFor(async () => expect(await db.farm.get("seen:lilypad")).toBeTruthy(), { timeout: SETTLE + 2000 });
  }, 30_000);
});

describe("never twice, never taken away", () => {
  it("Edit and Save on a finished check-in, and a reload, never earn the lily pad again", async () => {
    renderApp("/journal/check-in", TODAY);
    await finishCheckIn();
    await pause(SETTLE);
    await leaveJournal();
    await waitFor(async () => expect(await db.farm.get("seen:lilypad")).toBeTruthy(), { timeout: 2000 });
    const seen = await db.farm.get("seen:lilypad");
    cleanup();

    // Back in the Journal: Edit, change an answer, Save.
    renderApp("/journal/check-in", TODAY);
    const s = await screen.findByRole("region", { name: "Daily check-in" });
    await userEvent.click(await within(s).findByRole("button", { name: "Edit" }));
    const boxes = within(s).getAllByRole("textbox", { name: "Your answer" });
    await userEvent.type(boxes[0]!, ", and a pretend kite");
    await userEvent.click(within(s).getByRole("button", { name: "Save" }));
    await pause(SETTLE);
    await leaveJournal();
    await pause(1500);
    cleanup();
    renderApp("/today", TODAY); // a reload
    await pause(SETTLE);
    expect(await db.farm.get("seen:lilypad")).toEqual(seen); // same row, same stamp: never re-earned
    expect((await db.farm.toArray()).filter((r) => r.id === "seen:lilypad")).toHaveLength(1);
  }, 40_000);
});
