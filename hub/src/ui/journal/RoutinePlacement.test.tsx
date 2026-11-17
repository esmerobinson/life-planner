import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "../../data/db";
import { readSharePrivate } from "../../data/repo";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";
import { TOGETHER_WORDS } from "../together/wording";
import { ROUTINE_WORDS as W } from "./routineWording";

// Fix round 2, R-I1: yesterday's daily log sits below today's private tick, with its own tick for
// that day (PLACEHOLDER placement, for Design). Made-up values only.

const TODAY = "2026-11-12";
const YESTERDAY = "2026-11-11";

beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
  await confirmedDevice(db, await keyFor("fake-journal-routine-placement"));
});
afterEach(cleanup);
vi.setConfig({ testTimeout: 30_000 });

it("today's tick comes before yesterday's log; yesterday's log has its own tick, which ticks yesterday (not today)", async () => {
  const jk = await keyFor("fake-journal-routine-placement");
  renderApp("/journal/check-in", TODAY);
  const yesterday = await screen.findByRole("region", { name: W.logSectionYesterday }, { timeout: 5000 });
  const todayTick = await screen.findByRole("checkbox", { name: TOGETHER_WORDS.privateTick });
  expect(yesterday.contains(todayTick)).toBe(false);
  expect(todayTick.compareDocumentPosition(yesterday) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await userEvent.click(within(yesterday).getByRole("button", { name: W.logHeadingYesterday }));
  const own = await within(yesterday).findByRole("checkbox", { name: TOGETHER_WORDS.privateTickYesterday });
  await userEvent.click(own);
  await waitFor(async () => expect((await readSharePrivate(jk, YESTERDAY)).checkin).toBe(true));
  expect((await readSharePrivate(jk, TODAY)).checkin).toBe(false);
});
