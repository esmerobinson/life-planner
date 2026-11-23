import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "../../data/db";
import { saveDayLog, saveWeekReview } from "../../data/repo";
import { EMPTY_DAY_LOG, EMPTY_WEEK_REVIEW } from "../../journal/routine";
import { getDeviceId } from "../../sync/engine";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { openReadBackPart } from "../../test/readBack";
import { renderApp } from "../../test/renderApp";
import { ROUTINE_WORDS as W } from "./routineWording";
import { clock } from "../../together/testKit";

// The daily log and the weekly review in Read back (PLACEHOLDER placement): every day's log in
// the Daily check-in part, every week's review in the Mental health exercise part, word for word,
// a not-done one said so, and another device's version shown too. Made-up words only.

const TODAY = "2026-11-16";
const PHONE = "device-pretend-phone-1";

beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
  await confirmedDevice(db, await keyFor("fake-journal-routine-readback"));
});
afterEach(cleanup);
vi.setConfig({ testTimeout: 30_000 });

it("daily logs are in the Daily check-in part and weekly reviews in the Mental health exercise part, word for word", async () => {
  clock("2026-11-15T18:00:00"); // the review's Done is pressed on Sunday
  const jk = await keyFor("fake-journal-routine-readback");
  const me = await getDeviceId(db);
  await saveDayLog(jk, me, { ...EMPTY_DAY_LOG, schedule: "partly", scheduleNote: "Pretend Gallowmere note", todos: "yes" }, { date: "2026-11-15", seen: [], submittedAt: null }, true);
  await saveDayLog(jk, me, { ...EMPTY_DAY_LOG, todos: "no" }, { date: "2026-11-14", seen: [], submittedAt: null });
  await saveDayLog(jk, PHONE, { ...EMPTY_DAY_LOG, todos: "partly", todosNote: "Pretend phone version" }, { date: "2026-11-14", seen: [], submittedAt: null });
  await saveWeekReview(jk, me, { ...EMPTY_WEEK_REVIEW, well: "Pretend Hollowfern went well", values: 6, minDays: ["fri"] }, { date: "2026-11-15", seen: [], submittedAt: null }, true);

  renderApp("/journal/read-back", TODAY);
  const checkins = await openReadBackPart("Daily check-in");
  const sunday = within(checkins).getByText(`Sunday 15 November · ${W.readBackLog}`).closest("details")!;
  await userEvent.click(within(sunday).getByText(`Sunday 15 November · ${W.readBackLog}`));
  expect(within(sunday).getByText("Partly")).toBeVisible();
  expect(within(sunday).getByText("Pretend Gallowmere note")).toBeVisible();
  expect(within(sunday).getByText("Yes")).toBeVisible();
  expect(within(sunday).queryByText(W.notSubmitted)).toBeNull();
  const saturday = within(checkins).getByText(`Saturday 14 November · ${W.readBackLog}`).closest("details")!;
  await userEvent.click(within(saturday).getByText(`Saturday 14 November · ${W.readBackLog}`));
  expect(within(saturday).getByText(W.notSubmitted)).toBeVisible();
  expect(within(saturday).getByText("Pretend phone version")).toBeVisible(); // both versions, nothing hidden
  expect(within(saturday).getByText(W.alsoSaved)).toBeVisible();

  await userEvent.click(screen.getByRole("link", { name: "← Read back" }));
  const exercise = await openReadBackPart("Mental health exercise");
  const review = within(exercise).getByText(`Sunday 15 November · ${W.readBackReview}`).closest("details")!;
  await userEvent.click(within(review).getByText(`Sunday 15 November · ${W.readBackReview}`));
  await waitFor(() => expect(within(review).getByText("Pretend Hollowfern went well")).toBeVisible());
  expect(within(review).getByText("6 out of 10")).toBeVisible();
  expect(within(review).getByText("Friday")).toBeVisible();
});

it("weekly review v2: in the Mental health exercise part on the day she pressed Done, under its title, beside an earlier review (nothing lost)", async () => {
  const { saveWeeklyReview } = await import("../../data/repo");
  const { EMPTY_WEEKLY_REVIEW } = await import("../../journal/weeklyReview");
  const c = clock("2026-11-15T18:00:00");
  const jk = await keyFor("fake-journal-routine-readback");
  const me = await getDeviceId(db);
  await saveWeekReview(jk, me, { ...EMPTY_WEEK_REVIEW, well: "Pretend Hollowfern old week" }, { date: "2026-11-15", seen: [], submittedAt: null }, true);
  c.set("2026-11-16T10:00:00"); // Monday: last week's v2 review, Done
  await saveWeeklyReview(jk, me, { ...EMPTY_WEEKLY_REVIEW, selfHarm: "no", fight: "yes", fightAbout: "Pretend Hollowfern dishes", more: "Pretend Hollowfern reflections" }, { date: "2026-11-09", seen: [], submittedAt: null }, true);

  renderApp("/journal/read-back", TODAY);
  const exercise = await openReadBackPart("Mental health exercise");
  const line = "Monday 16 November · Weekly Review [11-09-2026-11-15-2026]";
  const v2 = within(exercise).getByText(line).closest("details")!;
  await userEvent.click(within(v2).getByText(line));
  await waitFor(() => expect(within(v2).getByText("Pretend Hollowfern dishes")).toBeVisible());
  expect(within(v2).getByText("Pretend Hollowfern reflections")).toBeVisible();
  expect(within(v2).getByText("Did you fight with Oliver?")).toBeVisible();
  expect(within(v2).queryByText(W.notSubmitted)).toBeNull();
  const old = within(exercise).getByText(`Sunday 15 November · ${W.readBackReview}`).closest("details")!;
  await userEvent.click(within(old).getByText(`Sunday 15 November · ${W.readBackReview}`));
  expect(within(old).getByText("Pretend Hollowfern old week")).toBeVisible();
});
