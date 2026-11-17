import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "../../data/db";
import { readDayLog, readWeekReview, reviewDoneDays, saveDayLog } from "../../data/repo";
import { EMPTY_DAY_LOG } from "../../journal/routine";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { emptyDb } from "../../together/testKit";
import { DailyLog, WeeklyReview } from "./RoutineForms";
import { ROUTINE_WORDS as W } from "./routineWording";

// The daily log and the weekly review boxes: saved as she goes, Done, Edit, nothing lost.
// Made-up words only.

const DAY = "2026-11-12"; // a Thursday
const SUNDAY = "2026-11-15";
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
    // Use it: its answers go into the box; the phone's version stays listed (nothing lost).
    await userEvent.click(screen.getByRole("button", { name: W.useThese }));
    await screen.findByDisplayValue("Pretend Mac words");
    await waitFor(async () => {
      const d = await readDayLog(jk, DAY);
      expect(d.fields.scheduleNote).toBe("Pretend Mac words");
      expect(d.others.map((o) => o.fields.scheduleNote)).toEqual(["Pretend phone words"]);
    });
    // Remove asks first.
    await userEvent.click(await screen.findByRole("button", { name: W.remove }));
    await userEvent.click(within(screen.getByRole("group", { name: W.removeAsk })).getByRole("button", { name: W.removeNo }));
    expect((await readDayLog(jk, DAY)).others).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: W.remove }));
    await userEvent.click(within(screen.getByRole("group", { name: W.removeAsk })).getByRole("button", { name: W.removeYes }));
    await waitFor(async () => expect(await readDayLog(jk, DAY)).toMatchObject({ others: [], fields: { scheduleNote: "Pretend Mac words" } }));
  });
});

describe("the weekly review", () => {
  it("is open on Sunday: every box saved, Done shows it done for the week and counts as a Mental health day", async () => {
    const jk = await key();
    render(<WeeklyReview jk={jk} today={SUNDAY} deviceId={MAC} />);
    await screen.findByText(W.reviewHeadingSunday);
    await userEvent.type(await screen.findByLabelText(W.well), "Pretend Larkspur went well");
    await userEvent.type(screen.getByLabelText(W.inWay), "Pretend fog");
    await userEvent.click(within(group(W.values)).getByRole("button", { name: "7" }));
    await userEvent.type(screen.getByLabelText(W.ifThen), "If pretend rain, then a pretend indoor walk");
    await userEvent.click(screen.getByLabelText("Wednesday"));
    await userEvent.click(screen.getByLabelText("Monday"));
    await userEvent.click(screen.getByRole("button", { name: W.done }));
    await screen.findByText(W.reviewDone);
    expect(await screen.findByText("7 out of 10")).toBeInTheDocument();
    expect(await screen.findByText("Monday, Wednesday")).toBeInTheDocument();
    await waitFor(async () =>
      expect(await readWeekReview(jk, SUNDAY)).toMatchObject({
        done: true, date: SUNDAY,
        fields: { well: "Pretend Larkspur went well", inWay: "Pretend fog", values: 7, ifThen: "If pretend rain, then a pretend indoor walk", minDays: ["mon", "wed"] },
      }),
    );
    expect([...(await reviewDoneDays(jk))]).toEqual([SUNDAY]);
  });

  it("any other day of the week it is folded until opened, then works the same; once started it stays open", async () => {
    const jk = await key();
    const { unmount } = render(<WeeklyReview jk={jk} today={DAY} deviceId={MAC} />);
    const fold = await screen.findByText(W.reviewHeadingWeek);
    expect(screen.queryByLabelText(W.well)).toBeNull();
    await userEvent.click(fold);
    await userEvent.type(await screen.findByLabelText(W.well), "Pretend Thursday words");
    unmount();
    await waitFor(async () => expect((await readWeekReview(jk, DAY)).fields.well).toBe("Pretend Thursday words"));
    // Sunday of the same week: the same review, open.
    render(<WeeklyReview jk={jk} today={SUNDAY} deviceId={MAC} />);
    expect(await screen.findByDisplayValue("Pretend Thursday words")).toBeInTheDocument();
  });
});
