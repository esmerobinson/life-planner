// Testing session (farm x journal): a farm problem never stops the journal. A damaged farm row
// in the database, farm writes that fail, or the farm table failing to read: the check-in still
// finishes and saves, and morning pages still file. What Esme would see if these failed: the
// Journal stuck or blank because of the farm. Fictional words only.

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { applyUntracked } from "../data/changeTracking";
import { db } from "../data/db";
import { ensureCheckinSet, readCheckinDay } from "../data/repo";
import type { JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { renderApp } from "../test/renderApp";
import { startRow } from "./state";

const TODAY = "2026-10-28";
const WORDS = ["Pretend: a teapot", "Pretend: a kite", "Pretend: a bath"];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-farm-never-blocks-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.items.clear(), db.farm.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
  await db.farm.put(startRow("devicePretend01", "2026-10-27"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  cleanup();
  await pause(150);
  vi.useRealTimers();
});

async function finishCheckIn() {
  await ensureCheckinSet(jk, TODAY, ["M1", "D3", "K2"]);
  renderApp("/journal/check-in", TODAY);
  const s = await screen.findByRole("region", { name: "Daily check-in" });
  for (let i = 0; i < WORDS.length; i++) {
    await within(s).findByRole("img", { name: `Question ${i + 1} of ${WORDS.length}` });
    await userEvent.type(within(s).getByLabelText("Your answer"), WORDS[i]!);
    await userEvent.click(within(s).getByRole("button", { name: i === WORDS.length - 1 ? "Finish" : "Next →" }));
  }
  expect(await within(s).findByText("Checked in for today")).toBeInTheDocument();
  await pause(3000); // past the farm's journal re-read
  expect(screen.getByText("Checked in for today")).toBeInTheDocument();
  const day = await readCheckinDay(jk, TODAY);
  expect(day.prompts.map((p) => day.answers.get(p)?.answer)).toEqual(WORDS);
}

it("a damaged farm row in the database (one a sync or an old build left there): the check-in finishes and saves", async () => {
  await applyUntracked(db, async () => {
    await db.farm.put({ id: "seen:hi", kind: "seen", sticker: "door", date: "2026-10-27" } as never);
    await db.farm.put({ id: "placed:no-such-sticker", kind: "placed", sticker: "no-such-sticker", spot: "nowhere", date: "2026-10-27" } as never);
    await db.farm.put({ id: "nonsense", kind: "coins", n: 3 } as never);
  });
  await finishCheckIn();
}, 20_000);

it("every farm write failing (a full disk, say): the check-in finishes and saves", async () => {
  vi.spyOn(db.farm, "put").mockImplementation((() => Promise.reject(new Error("pretend: the farm couldn't save"))) as never);
  await finishCheckIn();
}, 20_000);

it("the farm table failing to read: the check-in finishes and saves", async () => {
  vi.spyOn(db.farm, "toArray").mockImplementation((() => Promise.reject(new Error("pretend: the farm couldn't be read"))) as never);
  await finishCheckIn();
}, 20_000);

it("the farm table failing to read: I'm done on morning pages still files the page", async () => {
  vi.spyOn(db.farm, "toArray").mockImplementation((() => Promise.reject(new Error("pretend: the farm couldn't be read"))) as never);
  renderApp("/journal/morning", TODAY);
  const box = await screen.findByLabelText("Today's morning page");
  await userEvent.type(box, "Pretend morning words");
  await userEvent.click(screen.getByRole("button", { name: "I'm done" }));
  await waitFor(async () => expect(await db.journal.where("kind").equals("page").count()).toBe(1));
  await pause(3000);
  expect(screen.getByLabelText("Today's morning page")).toBeInTheDocument();
}, 20_000);
