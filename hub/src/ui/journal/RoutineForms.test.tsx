import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "../../data/db";
import { readDayLog, saveDayLog } from "../../data/repo";
import { EMPTY_DAY_LOG } from "../../journal/routine";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { emptyDb } from "../../together/testKit";
import { DailyLog } from "./RoutineForms";
import { ROUTINE_WORDS as W } from "./routineWording";

// The daily log box (and the pieces the weekly review tab shares): saved as she goes, Done, Edit,
// nothing lost. The weekly review's own tests: WeeklyReviewTab.test.tsx.
// Made-up words only.

const DAY = "2026-11-12"; // a Thursday
const MAC = "device-pretend-mac-01";
const PHONE = "device-pretend-phone-1";

beforeEach(emptyDb);
// These type a lot, key by key: more than the default 5 s on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

async function key() {
  const jk = await keyFor("fake-journal-routine-ui");
  await confirmedDevice(db, jk);
  return jk;
}

const group = (name: string) => screen.getByRole("group", { name });

describe("the daily log", () => {
  it("shows Today's routine count under \"Stuck to my daily schedule?\" as a hint, never as an answer", async () => {
    const jk = await key();
    await db.prefs.bulkPut([
      { id: `routine-tick:${DAY}:d1`, date: DAY, step: "d1", done: true },
      { id: `routine-tick:${DAY}:d2`, date: DAY, step: "d2", done: true },
    ]);
    render(<DailyLog jk={jk} date={DAY} deviceId={MAC} />);
    const box = await screen.findByRole("group", { name: W.schedule });
    expect(await within(box.parentElement!).findByText(W.routineHint(2, 10))).toBeInTheDocument();
    expect(within(box).getAllByRole("button").every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    expect((await readDayLog(jk, DAY)).fields.schedule).toBeNull();
  });

  it("a tap saves at once; a note saves after a pause; Done shows it done with Edit; an edit keeps it done", async () => {
    const jk = await key();
    render(<DailyLog jk={jk} date={DAY} deviceId={MAC} />);
    await userEvent.click(await within(await screen.findByRole("group", { name: W.schedule })).findByRole("button", { name: "Partly" }));
    await waitFor(async () => expect((await readDayLog(jk, DAY)).fields.schedule).toBe("partly"));
    expect(screen.getByRole("button", { name: W.done })).toBeEnabled();
    await userEvent.type(screen.getByLabelText(W.scheduleNote), "Pretend Brindle note");
    await waitFor(async () => expect((await readDayLog(jk, DAY)).fields.scheduleNote).toBe("Pretend Brindle note"), { timeout: 3000 });
    expect((await readDayLog(jk, DAY)).done).toBe(false);
    await userEvent.click(within(group(W.todos)).getByRole("button", { name: "Yes" }));
    await userEvent.click(screen.getByRole("button", { name: W.done }));
    await screen.findByText(W.logDone);
    expect(screen.getByText("Pretend Brindle note")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    await waitFor(async () => expect(await readDayLog(jk, DAY)).toMatchObject({ done: true, fields: { schedule: "partly", todos: "yes" } }));

    await userEvent.click(screen.getByRole("button", { name: W.edit }));
    await userEvent.click(within(group(W.todos)).getByRole("button", { name: "No" }));
    await userEvent.click(screen.getByRole("button", { name: W.save }));
    await screen.findByText(W.logDone);
    await waitFor(async () => expect(await readDayLog(jk, DAY)).toMatchObject({ done: true, others: [], fields: { todos: "no", scheduleNote: "Pretend Brindle note" } }));
  });

  it("typing then leaving at once (before the pause) still saves; so does the app being hidden", async () => {
    const jk = await key();
    const { unmount } = render(<DailyLog jk={jk} date={DAY} deviceId={MAC} />);
    await userEvent.type(await screen.findByLabelText(W.todosNote), "Pretend Quibble");
    unmount();
    await waitFor(async () => expect((await readDayLog(jk, DAY)).fields.todosNote).toBe("Pretend Quibble"));

    render(<DailyLog jk={jk} date={DAY} deviceId={MAC} />);
    const box = await screen.findByLabelText(W.todosNote);
    await waitFor(() => expect(box).toHaveValue("Pretend Quibble"));
    await userEvent.type(box, " and Snarrow");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await waitFor(async () => expect((await readDayLog(jk, DAY)).fields.todosNote).toBe("Pretend Quibble and Snarrow"));
  });

  it("another device's version is listed, never cleared silently: use it, or remove it once confirmed", async () => {
    const jk = await key();
    await saveDayLog(jk, MAC, { ...EMPTY_DAY_LOG, schedule: "yes", scheduleNote: "Pretend Mac words" }, { date: DAY, seen: [], submittedAt: null });
    await new Promise((r) => setTimeout(r, 3));
    await saveDayLog(jk, PHONE, { ...EMPTY_DAY_LOG, schedule: "no", scheduleNote: "Pretend phone words" }, { date: DAY, seen: [], submittedAt: null });
    render(<DailyLog jk={jk} date={DAY} deviceId={MAC} />);
    await screen.findByDisplayValue("Pretend phone words");
    expect(screen.getByText(W.earlierHere)).toBeInTheDocument();
    expect(screen.getByText("Pretend Mac words")).toBeInTheDocument();
    // Remove asks first; "Keep them" changes nothing.
    await userEvent.click(screen.getByRole("button", { name: W.remove }));
    await userEvent.click(within(screen.getByRole("group", { name: W.removeAsk })).getByRole("button", { name: W.removeNo }));
    expect((await readDayLog(jk, DAY)).others).toHaveLength(1);
    // Use it: its answers go into the box. The answers the box held are never cleared: they stay
    // listed, read-only, as an earlier version, and the day is settled (fix round 2, R-C1).
    await userEvent.click(screen.getByRole("button", { name: W.useThese }));
    await screen.findByDisplayValue("Pretend Mac words");
    await waitFor(async () => {
      const d = await readDayLog(jk, DAY);
      expect(d.fields).toMatchObject({ schedule: "yes", scheduleNote: "Pretend Mac words" });
      expect(d.others.map((o) => [o.fields.scheduleNote, o.settled])).toEqual([["Pretend phone words", true]]);
    });
    expect(await screen.findByText(W.earlierVersion)).toBeInTheDocument();
    expect(screen.getByText("Pretend phone words")).toBeInTheDocument(); // still on screen, read-only
    expect(screen.queryByRole("button", { name: W.useThese })).toBeNull();
    expect(screen.queryByRole("button", { name: W.remove })).toBeNull();
  });

  it("R-C1: words she typed a moment ago are never cleared by \"Use these answers\": they stay listed and in Read back", async () => {
    const jk = await key();
    await saveDayLog(jk, PHONE, { ...EMPTY_DAY_LOG, todos: "no", todosNote: "Pretend phone version" }, { date: DAY, seen: [], submittedAt: null });
    await new Promise((r) => setTimeout(r, 3));
    await saveDayLog(jk, MAC, { ...EMPTY_DAY_LOG, todos: "yes", todosNote: "Pretend Mac long reflection" }, { date: DAY, seen: [], submittedAt: null });
    render(<DailyLog jk={jk} date={DAY} deviceId={MAC} />);
    const box = await screen.findByDisplayValue("Pretend Mac long reflection");
    await userEvent.type(box, " and Pretend typed just now");
    await userEvent.click(screen.getByRole("button", { name: W.useThese })); // at once, no pause
    await screen.findByDisplayValue("Pretend phone version", undefined, { timeout: 5000 });
    await waitFor(async () => {
      const d = await readDayLog(jk, DAY);
      expect(d.fields.todosNote).toBe("Pretend phone version");
      expect(d.others.map((o) => o.fields.todosNote)).toEqual(["Pretend Mac long reflection and Pretend typed just now"]);
      expect(d.others[0]!.settled).toBe(true);
    }, { timeout: 5000 }); // two sealed saves: slower on a busy machine
    expect(screen.getByText("Pretend Mac long reflection and Pretend typed just now")).toBeInTheDocument();
    const { listDayLogs } = await import("../../data/repo");
    expect((await listDayLogs(jk, "2026-12-31"))[0]!.others.map((o) => o.fields.todosNote)).toEqual(["Pretend Mac long reflection and Pretend typed just now"]);
  });

  it("Remove, confirmed: that version is gone, the box's answers stay", async () => {
    const jk = await key();
    await saveDayLog(jk, MAC, { ...EMPTY_DAY_LOG, schedule: "yes", scheduleNote: "Pretend Mac words" }, { date: DAY, seen: [], submittedAt: null });
    await new Promise((r) => setTimeout(r, 3));
    await saveDayLog(jk, PHONE, { ...EMPTY_DAY_LOG, schedule: "no", scheduleNote: "Pretend phone words" }, { date: DAY, seen: [], submittedAt: null });
    render(<DailyLog jk={jk} date={DAY} deviceId={MAC} />);
    await screen.findByDisplayValue("Pretend phone words");
    await userEvent.click(screen.getByRole("button", { name: W.remove }));
    await userEvent.click(within(screen.getByRole("group", { name: W.removeAsk })).getByRole("button", { name: W.removeYes }));
    await waitFor(async () => expect(await readDayLog(jk, DAY)).toMatchObject({ others: [], fields: { scheduleNote: "Pretend phone words" } }));
  });

  it("\"Use these answers\" over a done box keeps it done (review M6)", async () => {
    const jk = await key();
    await saveDayLog(jk, PHONE, { ...EMPTY_DAY_LOG, todos: "no", todosNote: "Pretend undone phone words" }, { date: DAY, seen: [], submittedAt: null });
    await new Promise((r) => setTimeout(r, 3));
    await saveDayLog(jk, MAC, { ...EMPTY_DAY_LOG, todos: "yes" }, { date: DAY, seen: [], submittedAt: null }, true);
    render(<DailyLog jk={jk} date={DAY} deviceId={MAC} />);
    await screen.findByText(W.logDone);
    await userEvent.click(screen.getByRole("button", { name: W.useThese }));
    await waitFor(async () => expect(await readDayLog(jk, DAY)).toMatchObject({ done: true, fields: { todosNote: "Pretend undone phone words" } }));
    expect((await readDayLog(jk, DAY)).others.map((o) => [o.fields.todos, o.settled])).toEqual([["yes", true]]); // hers kept
  });

  it("yesterday's log: folded while empty, then filled and done like today's (it can still be changed today)", async () => {
    const jk = await key();
    render(<DailyLog jk={jk} date="2026-11-11" deviceId={MAC} yesterday />);
    const fold = await screen.findByRole("button", { name: W.logHeadingYesterday });
    expect(screen.getByLabelText(W.todosNote)).not.toBeVisible();
    await userEvent.click(fold);
    await userEvent.click(within(group(W.todos)).getByRole("button", { name: "Partly" }));
    await userEvent.click(screen.getByRole("button", { name: W.done }));
    await screen.findByText(W.logDoneYesterday);
    expect(await readDayLog(jk, "2026-11-11")).toMatchObject({ done: true, fields: { todos: "partly" } });
  });
});

