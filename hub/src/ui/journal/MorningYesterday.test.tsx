import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "../../data/db";
import { readMorningDay, saveMorningDraft } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { getDeviceId } from "../../sync/engine";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";
import { YESTERDAY_SAVED } from "./MorningPages";

// Yesterday's unfinished morning page: open it from today's page, finish it under
// yesterday's date, or go back to today with it untouched. Fictional words only.

const PASS = "fake-journal-passphrase-for-tests";
const TODAY = "2026-11-02";
const YESTERDAY = "2026-11-01";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor(PASS);
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
  await confirmedDevice(db, jk);
});

async function seedYesterday(text = "Pretend unfinished words from yesterday") {
  await saveMorningDraft(jk, YESTERDAY, await getDeviceId(db), text);
}

const OPEN = { name: "Open yesterday's page" };

it("no draft from yesterday: no button", async () => {
  renderApp("/journal/morning", TODAY);
  await screen.findByLabelText("Today's morning page");
  expect(screen.queryByRole("button", OPEN)).toBeNull();
  expect(screen.queryByText(YESTERDAY_SAVED)).toBeNull();
});

it("a draft from yesterday: the button sits with the line and opens it with its word count", async () => {
  await seedYesterday();
  renderApp("/journal/morning", TODAY);
  expect(await screen.findByText(YESTERDAY_SAVED)).toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", OPEN));
  expect(screen.getByText("Finishing yesterday's page")).toBeInTheDocument();
  expect(screen.getByLabelText("Yesterday's morning page")).toHaveValue("Pretend unfinished words from yesterday");
  expect(screen.getByText("5 of 1,000 words")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Back to today" })).toBeInTheDocument();
  expect(screen.queryByRole("button", OPEN)).toBeNull();
});

it("I'm done files it under yesterday, empties the draft and returns to today's empty box", async () => {
  await seedYesterday();
  renderApp("/journal/morning", TODAY);
  await userEvent.click(await screen.findByRole("button", OPEN));
  await userEvent.click(screen.getByRole("button", { name: "I'm done" }));
  const device = await getDeviceId(db);
  await waitFor(async () => expect((await readMorningDay(jk, YESTERDAY, device)).pages).toBe(1));
  expect((await readMorningDay(jk, YESTERDAY, device)).draft).toBe("");
  expect((await readMorningDay(jk, TODAY, device)).pages).toBe(0);
  const rows = await db.journal.where("date").equals(YESTERDAY).toArray();
  expect(rows.filter((r) => r.kind === "page")).toHaveLength(1);
  await waitFor(() => expect(screen.getByLabelText("Today's morning page")).toHaveValue(""));
  expect(screen.queryByLabelText("Yesterday's morning page")).toBeNull();
  expect(screen.queryByText("Finishing yesterday's page")).toBeNull();
  expect(screen.queryByRole("button", OPEN)).toBeNull();
  expect(screen.queryByText(YESTERDAY_SAVED)).toBeNull();
});

it("Back to today leaves the draft as it was and keeps what was typed in today's box", async () => {
  await seedYesterday();
  renderApp("/journal/morning", TODAY);
  await userEvent.type(await screen.findByLabelText("Today's morning page"), "Pretend today words");
  await userEvent.click(await screen.findByRole("button", OPEN));
  await userEvent.click(screen.getByRole("button", { name: "Back to today" }));
  const device = await getDeviceId(db);
  expect(screen.queryByLabelText("Yesterday's morning page")).toBeNull();
  expect(screen.getByLabelText("Today's morning page")).toHaveValue("Pretend today words");
  expect((await readMorningDay(jk, YESTERDAY, device)).draft).toBe("Pretend unfinished words from yesterday");
  expect((await readMorningDay(jk, YESTERDAY, device)).pages).toBe(0);
  expect(screen.getByText(YESTERDAY_SAVED)).toBeInTheDocument();
  expect(screen.getByRole("button", OPEN)).toBeInTheDocument();
});
