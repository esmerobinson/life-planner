import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { ensureCheckinSet, readCheckinDay, saveAnswer } from "../../data/repo";
import { journalAad, openJson, type JournalKey } from "../../journal/crypto";
import { getDeviceId } from "../../sync/engine";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";

// Testing session: more ways into the "check-in answer blanked by Next" bug (the cause was the
// "untouched" test in DailyCheckIn.tsx Question.move(); fixed in 1ae8d73 with moveAnswerOn).
// These triggers do NOT need the 800ms pause; they guard that the fix covers them all.
//
// What Esme would see: she answers a question, then (a) switches to another app or tab and
// comes back, or (b) leaves the Journal and comes back later, or (c) presses Next with a slow
// click / press-and-hold, and then presses Next: the question moves on, but later "Checked in
// for today" (and Past check-ins / Read back) shows that answer empty / "Skipped".
// (d) Two devices: her own words on this device are wiped when the box shows the phone's
// newer words and she presses Next without touching it.
// Fictional words only.

const TODAY = "2026-10-28";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-checkin-return-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
  await ensureCheckinSet(jk, TODAY, ["M1", "D3", "K2"]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const section = () => screen.findByRole("region", { name: "Daily check-in" });
const storedM1 = async () => (await readCheckinDay(jk, TODAY)).answers.get("M1");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** This device's own answer rows for the day, opened (prompt -> answer). */
async function ownRows(device: string) {
  const rows = (await db.journal.where("kind").equals("answer").toArray()).filter((r) => r.id.endsWith(`:${device}`));
  return Promise.all(rows.map((r) => openJson<{ prompt: string; answer: string | null; done: boolean }>(jk.key, r, journalAad(r.id))));
}

describe("check-in: Next keeps her answer however the autosave got there first", () => {
  it("(a) type, switch apps for a moment (app hidden), come back, Next at once: the answer is kept", async () => {
    renderApp("/journal/check-in", TODAY);
    const s = await section();
    await userEvent.type(await within(s).findByLabelText("Your answer"), "Pretend answer before switching apps");
    // The app goes to the background and comes back (no 800ms pause in typing needed).
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(async () => expect((await storedM1())?.answer).toBe("Pretend answer before switching apps"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    fireEvent(document, new Event("visibilitychange"));
    await wait(200); // the page re-reads the day
    await userEvent.click(within(s).getByRole("button", { name: "Next →" }));
    expect(await within(s).findByRole("img", { name: "Question 2 of 3" })).toBeInTheDocument();
    await waitFor(async () => expect((await storedM1())?.done).toBe(true));
    expect((await storedM1())?.answer).toBe("Pretend answer before switching apps");
  }, 15_000);

  it("(b) type, leave the Journal, come back later, Next: the answer is kept", async () => {
    const first = renderApp("/journal/check-in", TODAY);
    const s = await section();
    await userEvent.type(await within(s).findByLabelText("Your answer"), "Pretend answer from earlier");
    first.unmount(); // she goes elsewhere before Next (the box saves on the way out)
    await waitFor(async () => expect((await storedM1())?.answer).toBe("Pretend answer from earlier"));
    vi.useRealTimers();
    renderApp("/journal/check-in", TODAY);
    const again = await section();
    expect(await within(again).findByLabelText("Your answer")).toHaveValue("Pretend answer from earlier");
    await userEvent.click(within(again).getByRole("button", { name: "Next →" }));
    expect(await within(again).findByRole("img", { name: "Question 2 of 3" })).toBeInTheDocument();
    await waitFor(async () => expect((await storedM1())?.done).toBe(true));
    expect((await storedM1())?.answer).toBe("Pretend answer from earlier");
  }, 15_000);

  it("(c) type, then a slow click on Next (the box loses focus, the click lands a moment later): the answer is kept", async () => {
    renderApp("/journal/check-in", TODAY);
    const s = await section();
    const box = await within(s).findByLabelText("Your answer");
    await userEvent.type(box, "Pretend answer then a slow click");
    // Pressing the button takes focus from the box first (blur saves); the click lands ~300ms later.
    fireEvent.blur(box);
    await wait(300);
    fireEvent.click(within(s).getByRole("button", { name: "Next →" }));
    expect(await within(s).findByRole("img", { name: "Question 2 of 3" })).toBeInTheDocument();
    await waitFor(async () => expect((await storedM1())?.done).toBe(true));
    expect((await storedM1())?.answer).toBe("Pretend answer then a slow click");
  }, 15_000);

  it("(d) two devices: Next on a box showing the phone's newer words never wipes what she wrote on this device", async () => {
    const device = await getDeviceId(db);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 28, 11, 0)); // this morning, on this laptop
    await saveAnswer(jk, TODAY, "M1", device, "Pretend words typed on this laptop", false);
    renderApp("/journal/check-in", TODAY);
    const s = await section();
    expect(await within(s).findByLabelText("Your answer")).toHaveValue("Pretend words typed on this laptop");
    // Later the phone (not moved past there either) writes newer words; sync brings them in.
    vi.setSystemTime(new Date(2026, 9, 28, 12, 5)); // five minutes later
    await act(async () => {
      await saveAnswer(jk, TODAY, "M1", "device-phone-01", "Pretend newer words from the phone", false);
    });
    await waitFor(() => expect(within(s).getByLabelText("Your answer")).toHaveValue("Pretend newer words from the phone"));
    await userEvent.click(within(s).getByRole("button", { name: "Next →" }));
    expect(await within(s).findByRole("img", { name: "Question 2 of 3" })).toBeInTheDocument();
    await waitFor(async () => expect((await storedM1())?.done).toBe(true));
    const mine = (await ownRows(device)).find((e) => e.prompt === "M1");
    expect(mine?.answer).toBe("Pretend words typed on this laptop");
  }, 15_000);
});
