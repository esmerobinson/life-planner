import { render, screen, waitFor } from "@testing-library/react";
import { db } from "../../data/db";
import { readDayLog, saveDayLog, saveSharePrivate } from "../../data/repo";
import { EMPTY_DAY_LOG } from "../../journal/routine";
import { makeRunner } from "../../together/runner";
import { SEND_ROUTINE_CHALLENGES } from "../../together/routineChallenges";
import { readSent, saveSent, TOGETHER_META } from "../../together/store";
import { clock, DEVICE, emptyDb, fakeTogether, journalDay, ME } from "../../together/testKit";
import { PrivateDayTick } from "./PrivateDayTick";
import { RoutineDayLine } from "./RoutineDayLine";
import { TogetherBox } from "./TogetherBox";
import { TOGETHER_WORDS as W } from "./wording";

// Review I4, I5: what the Together box, the private ticks and each day's log say about the daily
// log's challenges: nothing while they are switched off; while on, that a day goes for good 24 h
// after it ends, and why a day won't go. Made-up values only.

beforeEach(emptyDb);
afterEach(() => void (SEND_ROUTINE_CHALLENGES.on = false));

const D = "2026-11-10";

async function signedInHere() {
  const c = clock(`${D}T20:00:00`);
  const fake = fakeTogether(c);
  await db.syncMeta.put({ key: TOGETHER_META, value: { url: fake.url, anonKey: fake.anonKey, userId: ME, coupleId: "pretend-couple" } });
  await saveSent(db, { userId: ME, since: D, salt: "00", refused: {} });
  return fake;
}

it("switched off (as shipped): the box, the tick and the day say nothing about the daily log", async () => {
  const fake = await signedInHere();
  const { jk } = await journalDay(D, {});
  await saveDayLog(jk, DEVICE, { ...EMPTY_DAY_LOG, todos: "yes" }, { date: D, seen: [], submittedAt: null }, true);
  render(
    <>
      <TogetherBox runner={makeRunner(fake.fetch)} fetchFn={fake.fetch} />
      <PrivateDayTick jk={jk} date={D} part="checkin" />
      <RoutineDayLine jk={jk} date={D} day={await readDayLog(jk, D)} />
    </>,
  );
  await screen.findByText(W.howItSends);
  for (const t of [W.routineHowItSends, W.routinePrivateCaveat, ...Object.values(W.routineDay)]) expect(screen.queryByText(t)).toBeNull();
  expect(screen.queryByText(/daily log/i)).toBeNull();
});

it("switched on: the box says it goes for good 24 h after the day ends, and why nothing goes yet", async () => {
  SEND_ROUTINE_CHALLENGES.on = true;
  const fake = await signedInHere();
  await saveSent(db, { ...(await readSent(db))!, routineWaiting: "not-accepted", routineHeld: { versions: 2 } });
  const { jk } = await journalDay(D, {});
  render(
    <>
      <TogetherBox runner={makeRunner(fake.fetch)} fetchFn={fake.fetch} />
      <PrivateDayTick jk={jk} date={D} part="checkin" />
    </>,
  );
  expect(await screen.findByText(W.routineHowItSends)).toBeInTheDocument();
  expect(W.routineHowItSends).toMatch(/24 hours after the day ends/);
  expect(W.routineHowItSends).toMatch(/hides it there, but Oliver's database still keeps the text/);
  expect(screen.getAllByText(W.routinePrivateCaveat).length).toBeGreaterThanOrEqual(2); // the box and the tick
  expect(screen.getByText(W.routineWaiting["not-accepted"])).toBeInTheDocument();
  expect(screen.getByText(W.routineVersions(2))).toBeInTheDocument();
});

describe("switched on: each day's log says whether and when it goes, and why not", () => {
  beforeEach(() => void (SEND_ROUTINE_CHALLENGES.on = true));

  it("not done; done (goes 24 h after the day ends); private; two versions", async () => {
    await signedInHere();
    const { jk } = await journalDay(D, {});
    await saveDayLog(jk, DEVICE, { ...EMPTY_DAY_LOG, todos: "yes" }, { date: D, seen: [], submittedAt: null });
    const { unmount } = render(<RoutineDayLine jk={jk} date={D} day={await readDayLog(jk, D)} />);
    expect(await screen.findByText(W.routineDay["not-done"])).toBeInTheDocument();
    unmount();
    await saveDayLog(jk, DEVICE, { ...EMPTY_DAY_LOG, todos: "yes" }, { date: D, seen: (await readDayLog(jk, D)).seen, submittedAt: null }, true);
    const r2 = render(<RoutineDayLine jk={jk} date={D} day={await readDayLog(jk, D)} />);
    expect(await screen.findByText(W.routineDay["not-final"])).toBeInTheDocument();
    r2.unmount();
    await saveSharePrivate(jk, D, "checkin", true);
    const r3 = render(<RoutineDayLine jk={jk} date={D} day={await readDayLog(jk, D)} />);
    expect(await screen.findByText(W.routineDay.private)).toBeInTheDocument();
    r3.unmount();
    await saveSharePrivate(jk, D, "checkin", false);
    await saveDayLog(jk, "device-pretend-phone-1", { ...EMPTY_DAY_LOG, schedule: "no" }, { date: D, seen: [], submittedAt: null }, true);
    render(<RoutineDayLine jk={jk} date={D} day={await readDayLog(jk, D)} />);
    expect(await screen.findByText(W.routineDay.versions)).toBeInTheDocument();
  });

  it("already in Together: it says it can't be changed there; not signed in here: nothing", async () => {
    await signedInHere();
    const { jk } = await journalDay(D, {});
    await saveDayLog(jk, DEVICE, { ...EMPTY_DAY_LOG, todos: "yes" }, { date: D, seen: [], submittedAt: null }, true);
    await saveSent(db, { ...(await readSent(db))!, routine: { [`todos:${D}`]: "sent" } });
    const { unmount } = render(<RoutineDayLine jk={jk} date={D} day={await readDayLog(jk, D)} />);
    expect(await screen.findByText(W.routineDay.sent)).toBeInTheDocument();
    unmount();
    await db.syncMeta.delete(TOGETHER_META);
    render(<RoutineDayLine jk={jk} date={D} day={await readDayLog(jk, D)} />);
    await new Promise((r) => setTimeout(r, 100));
    await waitFor(() => expect(screen.queryByText(W.routineDay.sent)).toBeNull());
  });
});
