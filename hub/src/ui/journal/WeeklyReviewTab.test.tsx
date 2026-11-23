import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "../../data/db";
import { readWeeklyReview, reviewDoneDays, saveWeekReview } from "../../data/repo";
import { EMPTY_WEEK_REVIEW } from "../../journal/routine";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { clock, emptyDb } from "../../together/testKit";
import { ROUTINE_WORDS as RW, WEEKLY_WORDS as W } from "./routineWording";
import { WeeklyReviewTab } from "./WeeklyReviewTab";

// Weekly review v2's tab: the title and which week, Yes opening its boxes, saved as she goes,
// Done, and every past review readable. Made-up words only.

const MON = "2026-11-23";
const THU = "2026-11-26";
const FRI = "2026-11-27";
const LAST = "2026-11-16";
const MAC = "device-pretend-mac-01";
const LAST_TITLE = "Weekly Review [11-16-2026-11-22-2026]";
const THIS_TITLE = "Weekly Review [11-23-2026-11-29-2026]";

beforeEach(emptyDb);
vi.setConfig({ testTimeout: 30_000 });

async function key() {
  const jk = await keyFor("fake-journal-weekly-tab");
  await confirmedDevice(db, jk);
  return jk;
}
const group = (name: string) => screen.getByRole("group", { name });
const region = () => screen.getByRole("region", { name: W.tab });

describe("which week, and its title", () => {
  it("Monday, last week not done: last week's, with a switch to this week and back", async () => {
    const jk = await key();
    render(<WeeklyReviewTab jk={jk} today={MON} deviceId={MAC} />);
    expect(await screen.findByRole("heading", { name: LAST_TITLE })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: W.switchToThis }));
    expect(await screen.findByRole("heading", { name: THIS_TITLE })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: W.switchToLast }));
    expect(await screen.findByRole("heading", { name: LAST_TITLE })).toBeInTheDocument();
  });

  it("Thursday with last week's done (even the earlier kind): this week's", async () => {
    clock("2026-11-22T19:00:00");
    const jk = await key();
    await saveWeekReview(jk, MAC, { ...EMPTY_WEEK_REVIEW, well: "Pretend Thimble" }, { date: "2026-11-22", seen: [], submittedAt: null }, true);
    render(<WeeklyReviewTab jk={jk} today={THU} deviceId={MAC} />);
    expect(await screen.findByRole("heading", { name: THIS_TITLE })).toBeInTheDocument();
  });

  it("Friday: this week's", async () => {
    const jk = await key();
    render(<WeeklyReviewTab jk={jk} today={FRI} deviceId={MAC} />);
    expect(await screen.findByRole("heading", { name: THIS_TITLE })).toBeInTheDocument();
  });
});

describe("the questions", () => {
  it("Yes opens its boxes; No closes an empty one, never one with words in it", async () => {
    const jk = await key();
    render(<WeeklyReviewTab jk={jk} today={FRI} deviceId={MAC} />);
    await screen.findByRole("heading", { name: THIS_TITLE });
    expect(screen.queryByLabelText(W.selfHarmWhat)).toBeNull();
    await userEvent.click(within(group(W.selfHarm)).getByRole("button", { name: "Yes" }));
    expect(screen.getByLabelText(W.selfHarmWhat)).toBeInTheDocument();
    await userEvent.click(within(group(W.selfHarm)).getByRole("button", { name: "No" }));
    expect(screen.queryByLabelText(W.selfHarmWhat)).toBeNull();

    expect(screen.queryByLabelText(W.fightAbout)).toBeNull();
    await userEvent.click(within(group(W.fight)).getByRole("button", { name: "Yes" }));
    for (const l of [W.fightAbout, W.fightTrigger, W.fightResolved]) expect(screen.getByLabelText(l)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(W.fightTrigger), "Pretend Wendle trigger");
    await userEvent.click(within(group(W.fight)).getByRole("button", { name: "No" }));
    expect(screen.getByLabelText(W.fightTrigger)).toHaveValue("Pretend Wendle trigger"); // never hidden
    await waitFor(async () => expect(await readWeeklyReview(jk, "2026-11-23")).toMatchObject({ fields: { fight: "no", fightTrigger: "Pretend Wendle trigger" } }), { timeout: 3000 });

    // Always there: the urges note, achieved and struggled, the sleep note, proud, more.
    for (const l of [W.urgesNote, W.achieved, W.struggled, W.dbt, W.sleepNote, W.proud, W.more, RW.well, RW.inWay, RW.ifThen]) {
      expect(screen.getByLabelText(l)).toBeInTheDocument();
    }
    for (const g of [W.urges, W.productive, W.sleep, RW.values]) expect(group(g)).toBeInTheDocument();
    expect(within(group(W.productive)).getAllByRole("button").map((b) => b.textContent)).toEqual(["Yes", "Partly", "No"]);
    expect(within(group(W.sleep)).getAllByRole("button").map((b) => b.textContent)).toEqual(["Good", "OK", "Poor"]);
    expect(screen.getByRole("region", { name: "Completed this week" })).toBeInTheDocument();
  });

  it("in her order", async () => {
    const jk = await key();
    render(<WeeklyReviewTab jk={jk} today={FRI} deviceId={MAC} />);
    await screen.findByRole("heading", { name: THIS_TITLE });
    await userEvent.click(within(group(W.selfHarm)).getByRole("button", { name: "Yes" }));
    await userEvent.click(within(group(W.fight)).getByRole("button", { name: "Yes" }));
    const text = region().textContent!;
    const order = [
      W.selfHarm, W.selfHarmWhat, W.urges, W.fight, W.fightAbout, W.fightTrigger, W.fightResolved, W.productive, W.achieved, W.struggled,
      "Completed this week", RW.well, RW.inWay, RW.values, RW.ifThen, RW.minDays, W.dbt, W.sleep, W.proud, W.more,
    ];
    const at = order.map((w) => text.indexOf(w));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("typing on across an autosave keeps focus and every key (the box is never rebuilt)", async () => {
    const jk = await key();
    render(<WeeklyReviewTab jk={jk} today={FRI} deviceId={MAC} />);
    const box = await screen.findByLabelText(W.more);
    await userEvent.type(box, "Pretend first");
    await waitFor(async () => expect((await readWeeklyReview(jk, MON)).fields.more).toBe("Pretend first"), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 100));
    expect(document.activeElement).toBe(screen.getByLabelText(W.more));
    await userEvent.keyboard(" more words");
    await waitFor(async () => expect((await readWeeklyReview(jk, MON)).fields.more).toBe("Pretend first more words"), { timeout: 3000 });
  });

  it("Done: shown done with her answers and Edit; it belongs to the day she pressed Done (Mental health work)", async () => {
    clock(`${MON}T11:00:00`);
    const jk = await key();
    render(<WeeklyReviewTab jk={jk} today={MON} deviceId={MAC} />);
    await screen.findByRole("heading", { name: LAST_TITLE });
    await userEvent.click(within(group(W.selfHarm)).getByRole("button", { name: "No" }));
    await userEvent.type(screen.getByLabelText(W.proud), "Pretend Wendle sketch");
    await userEvent.click(within(group(W.sleep)).getByRole("button", { name: "OK" }));
    await userEvent.click(screen.getByRole("button", { name: RW.done }));
    await screen.findByText(W.done);
    expect(screen.getByText("Pretend Wendle sketch")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: RW.edit })).toBeInTheDocument();
    await waitFor(async () => expect(await readWeeklyReview(jk, LAST)).toMatchObject({ done: true, day: MON, date: LAST }));
    expect([...(await reviewDoneDays(jk))]).toEqual([MON]);
    // The title stays on the week she was doing (it isn't swapped away once done).
    expect(screen.getByRole("heading", { name: LAST_TITLE })).toBeInTheDocument();
  });
});

describe("past reviews", () => {
  it("the earlier review and other weeks' are listed, read-only, word for word", async () => {
    clock("2026-11-15T19:00:00");
    const jk = await key();
    await saveWeekReview(jk, MAC, { ...EMPTY_WEEK_REVIEW, well: "Pretend Old Pennyroyal week", values: 4 }, { date: "2026-11-15", seen: [], submittedAt: null }, true);
    render(<WeeklyReviewTab jk={jk} today={FRI} deviceId={MAC} />);
    const past = await screen.findByRole("region", { name: W.past });
    const item = await within(past).findByText("Weekly Review [11-09-2026-11-15-2026] (earlier questions)");
    await userEvent.click(item);
    expect(within(past).getByText("Pretend Old Pennyroyal week")).toBeVisible();
    expect(within(past).getByText("4 out of 10")).toBeVisible();
    expect(within(past).queryByRole("textbox")).toBeNull();
  });
});
