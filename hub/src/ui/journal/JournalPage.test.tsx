import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../../data/db";
import { ensureCheckinSet, finishMorningPage, readCheckinDay, readMorningDay, saveAnswer } from "../../data/repo";
import { journalAad, sealJson, type JournalKey } from "../../journal/crypto";
import { loadJournalKey } from "../../journal/keyStore";
import { PROMPT_BY_ID } from "../../journal/prompts";
import { SyncController } from "../../sync/controller";
import { FakeSyncServer } from "../../sync/fakeServer";
import { getDeviceId, saveSyncSettings } from "../../sync/engine";
import { deriveToken } from "../../sync/token";
import { confirmedDevice, keyFor, verifierRow } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";
import { CHECKING_LINE, JournalPage } from "./JournalPage";
import { DailyCheckIn } from "./DailyCheckIn";

// The Journal page (journal brief; review fix round 1). Fictional passphrases and words only.

const PASS = "fake-journal-passphrase-for-tests";
const TODAY = "2026-10-28";
const SECRET = "Pretend secret morning words about a pretend dream";
let jk: JournalKey;
let other: JournalKey;
let token: string;
beforeAll(async () => {
  jk = await keyFor(PASS);
  other = await keyFor("fake-other-passphrase");
  token = await deriveToken(PASS);
});

beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const unlocked = () => confirmedDevice(db, jk);
const me = () => getDeviceId(db);

describe("locked", () => {
  it("without a confirmed key: only Unlock journal; entries waiting here are not shown or written", async () => {
    await db.journal.put(await verifierRow(jk));
    const before = await db.journal.toArray();
    renderApp("/journal", TODAY);
    expect(await screen.findByRole("heading", { name: "Unlock journal" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Morning pages" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Daily check-in" })).toBeNull();
    expect(await db.journal.toArray()).toEqual(before);
  });

  it("a passphrase that doesn't open the verifier is refused and nothing is kept; the right one opens the journal", async () => {
    await db.journal.put(await verifierRow(jk));
    renderApp("/journal", TODAY);
    const field = await screen.findByLabelText("Sync passphrase");
    await userEvent.type(field, "fake-wrong-passphrase");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent("isn't the journal's passphrase");
    expect(await loadJournalKey(db)).toBeUndefined();
    expect(await db.syncMeta.get("journalCandidate")).toBeUndefined();
    expect(field).toHaveValue("");
    await userEvent.type(field, PASS);
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByRole("heading", { name: "Morning pages" }, { timeout: 5000 })).toBeInTheDocument();
  });

  it("without sync set up and no verifier, it says to set up sync first", async () => {
    renderApp("/journal", TODAY);
    await userEvent.type(await screen.findByLabelText("Sync passphrase"), PASS);
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    const alert = await screen.findByRole("alert", {}, { timeout: 5000 });
    expect(alert).toHaveTextContent("Set up sync on this device first");
    expect(within(alert).getByRole("link", { name: "Sync" })).toHaveAttribute("href", "/sync");
  });

  it("first device: 'Checking your passphrase with sync…' (nothing can be written) until sync accepts it", async () => {
    await saveSyncSettings(db, { serverUrl: "https://sync.example.test", token });
    const server = new FakeSyncServer(token);
    server.inject({ networkError: true }); // the first try is offline
    const controller = new SyncController({ db, fetch: server.fetch });
    await controller.reload(); // as the running app has it (settings read)
    render(
      <MemoryRouter initialEntries={["/journal"]}>
        <JournalPage today={TODAY} controller={controller} />
      </MemoryRouter>,
    );
    await userEvent.type(await screen.findByLabelText("Sync passphrase"), PASS);
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText(CHECKING_LINE, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sync" })).toHaveAttribute("href", "/sync");
    expect(screen.queryByRole("button", { name: "Write now" })).toBeNull();
    expect(await db.journal.count()).toBe(0);
    await waitFor(() => expect(server.syncRequests).toHaveLength(1)); // the page asked once (offline)
    await act(() => controller.syncNow()); // joins any run still in flight
    await act(() => controller.syncNow()); // online now
    expect(await screen.findByRole("heading", { name: "Morning pages" }, { timeout: 5000 })).toBeInTheDocument();
    expect(await db.journal.get("verifier")).toBeTruthy();
  });
});

describe("morning pages", () => {
  it("the star calendar: a star on each done day, today outlined, the streak line", async () => {
    await unlocked();
    for (const d of ["2026-10-02", "2026-10-26", "2026-10-27"]) await finishMorningPage(jk, d, "device-other-1", "Pretend");
    renderApp("/journal", TODAY);
    const cal = await screen.findByRole("group", { name: "Morning pages calendar" });
    await waitFor(() => expect(cal.querySelectorAll(".journal-day.on")).toHaveLength(3));
    expect(cal.querySelector('[data-date="2026-10-28"]')).toHaveClass("today");
    expect(screen.getByText("2 days in a row · 3 this month")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("September")).toBeInTheDocument();
  });

  it("Write now: the draft saves itself and reopens; I'm done gives the star; the words never show", async () => {
    await unlocked();
    renderApp("/journal", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Write now" }));
    await userEvent.type(screen.getByLabelText("Today's morning page"), "Pretend draft words");
    expect(screen.getByText("3 of 750 words")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    const device = await me();
    await waitFor(async () => expect((await readMorningDay(jk, TODAY, device)).draft).toBe("Pretend draft words"));
    await userEvent.click(await screen.findByRole("button", { name: "Write now" }));
    expect(screen.getByLabelText("Today's morning page")).toHaveValue("Pretend draft words");
    await userEvent.type(screen.getByLabelText("Today's morning page"), " and more");
    await userEvent.click(screen.getByRole("button", { name: "I'm done" }));
    expect(await screen.findByText("Done for today")).toBeInTheDocument();
    await waitFor(async () => expect(await readMorningDay(jk, TODAY, device)).toMatchObject({ done: true, draft: "", pages: 1 }));
    expect(document.body.textContent).not.toContain("Pretend draft");
    await userEvent.click(screen.getByRole("button", { name: "Write now" }));
    expect(screen.getByLabelText("Today's morning page")).toHaveValue("");
  });

  it("a draft typed when the app goes to the background is saved at once (no waiting for the pause)", async () => {
    await unlocked();
    renderApp("/journal", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Write now" }));
    await userEvent.type(screen.getByLabelText("Today's morning page"), "Pretend quick words");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    const device = await me();
    await waitFor(async () => expect((await readMorningDay(jk, TODAY, device)).draft).toBe("Pretend quick words"), { timeout: 600 });
  });

  it("if the key is gone while writing, closing the view writes nothing", async () => {
    await unlocked();
    renderApp("/journal", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Write now" }));
    const box = screen.getByLabelText("Today's morning page");
    await userEvent.type(box, "Pretend words");
    const device = await me();
    await waitFor(async () => expect((await readMorningDay(jk, TODAY, device)).draft).toBe("Pretend words"));
    await userEvent.type(box, " more");
    await db.syncMeta.delete("journalKey"); // e.g. a Replace restore elsewhere
    expect(await screen.findByRole("heading", { name: "Unlock journal" })).toBeInTheDocument(); // the view closed
    await new Promise((r) => setTimeout(r, 50));
    // The last draft stays the one written while the key was confirmed.
    const { readMorningDay: read } = await import("../../data/repo");
    expect((await read(jk, TODAY, device)).draft).toBe("Pretend words");
  });

  it("Read back: under 4 weeks only 'Opens on', no words; from day 28 the page opens read-only", async () => {
    await unlocked();
    await finishMorningPage(jk, "2026-10-01", "device-other-1", SECRET);
    const first = renderApp("/journal", "2026-10-28");
    await userEvent.click(await screen.findByText("Read back"));
    expect(await screen.findByText("Opens on Thursday 29 October")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("Pretend secret");
    first.unmount();
    vi.useRealTimers();
    renderApp("/journal", "2026-10-29");
    await userEvent.click(await screen.findByText("Read back"));
    await userEvent.click(await screen.findByText("Thursday 1 October"));
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
  });

  it("an entry that won't open here is noted, and Write now / Add photo still work (nothing blocks the day)", async () => {
    await unlocked();
    const id = `page:${TODAY}:theirs`;
    await db.journal.put({ id, kind: "page", date: TODAY, fp: other.fp, ...(await sealJson(other.key, { v: 1, text: "x", at: 1 }, journalAad(id))) });
    const device = await me();
    const did = `draft:${TODAY}:${device}`;
    await db.journal.put({ id: did, kind: "draft", date: TODAY, fp: other.fp, ...(await sealJson(other.key, { v: 1, text: "x" }, journalAad(did))) });
    renderApp("/journal", TODAY);
    expect(await screen.findByText("Can't open this entry on this device")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write now" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add photo" })).toBeEnabled();
    expect(screen.getByLabelText("Photo of today's pages")).toHaveAttribute("capture", "environment");
  });
});

describe("daily check-in", () => {
  const section = () => screen.findByRole("region", { name: "Daily check-in" });

  it("the first device writes the day's questions; one at a time; Next, Skip (keeps typed text), Finish", async () => {
    await unlocked();
    renderApp("/journal", TODAY);
    const s = await section();
    expect(await within(s).findByRole("img", { name: "Question 1 of 3" })).toBeInTheDocument();
    await waitFor(async () => expect(await db.journal.get(`set:${TODAY}`)).toBeTruthy());
    const set = (await readCheckinDay(jk, TODAY)).prompts;
    await userEvent.type(within(s).getByLabelText("Your answer"), "Pretend first answer");
    await userEvent.click(within(s).getByRole("button", { name: "Next →" }));
    expect(await within(s).findByRole("img", { name: "Question 2 of 3" })).toBeInTheDocument();
    await userEvent.type(within(s).getByLabelText("Your answer"), "Pretend half thought");
    await userEvent.click(within(s).getByRole("button", { name: "Skip" }));
    expect(await within(s).findByRole("img", { name: "Question 3 of 3" })).toBeInTheDocument();
    await userEvent.click(within(s).getByRole("button", { name: "Finish" }));
    expect(await within(s).findByText("Checked in for today")).toBeInTheDocument();
    expect(within(s).getByText("Kind to yourself today? That counts.")).toBeInTheDocument();
    const day = await readCheckinDay(jk, TODAY);
    expect(day.answers.get(set[0]!)).toMatchObject({ answer: "Pretend first answer", done: true });
    expect(day.answers.get(set[1]!)).toMatchObject({ answer: "Pretend half thought", done: true });
    expect(day.answers.get(set[2]!)).toMatchObject({ answer: null, done: true });
    expect(JSON.stringify(await db.journal.toArray())).not.toContain("Pretend");
  });

  it("uses the day's questions another device already chose", async () => {
    await unlocked();
    await ensureCheckinSet(jk, TODAY, ["K4", "D6", "M1"]);
    renderApp("/journal", TODAY);
    const s = await section();
    await within(s).findByRole("img", { name: "Question 1 of 3" });
    expect(within(s.querySelector<HTMLElement>(".journal-question")!).getByText(PROMPT_BY_ID.get("K4")!.text)).toBeInTheDocument();
  });

  it("an answer typed but not moved past is saved when leaving, and comes back on the same question", async () => {
    await unlocked();
    await ensureCheckinSet(jk, TODAY, ["M1", "D3", "K2"]);
    const first = renderApp("/journal", TODAY);
    const s = await section();
    await userEvent.type(await within(s).findByLabelText("Your answer"), "Pretend long answer");
    first.unmount(); // she goes elsewhere before Next
    await waitFor(async () =>
      expect((await readCheckinDay(jk, TODAY)).answers.get("M1")).toMatchObject({ answer: "Pretend long answer", done: false }),
    );
    vi.useRealTimers();
    renderApp("/journal", TODAY);
    const again = await section();
    expect(await within(again).findByRole("img", { name: "Question 1 of 3" })).toBeInTheDocument();
    expect(within(again).getByLabelText("Your answer")).toHaveValue("Pretend long answer");
  });

  it("re-reads today live: another device's answers show, and are never written over", async () => {
    await unlocked();
    await ensureCheckinSet(jk, TODAY, ["M1", "D3", "K2"]);
    await saveAnswer(jk, TODAY, "M1", "device-phone-01", "Pretend mine", true);
    renderApp("/journal", TODAY);
    const s = await section();
    expect(await within(s).findByRole("img", { name: "Question 2 of 3" })).toBeInTheDocument();
    // The phone answers D3 and K2; sync brings them in.
    await act(async () => {
      await saveAnswer(jk, TODAY, "D3", "device-phone-01", "Pretend phone D3", true);
      await saveAnswer(jk, TODAY, "K2", "device-phone-01", "Pretend phone K2", true);
    });
    expect(await within(s).findByText("Checked in for today")).toBeInTheDocument();
    const answers = s.querySelector<HTMLElement>(".journal-answers")!;
    const boxes = within(answers).getAllByLabelText("Your answer") as HTMLTextAreaElement[];
    expect(boxes.map((b) => b.value)).toEqual(["Pretend mine", "Pretend phone D3", "Pretend phone K2"]);
    expect(within(answers).getByText("Observe · Workbook p. 134")).toBeInTheDocument();
  });

  it("Skip on a box showing another device's answer, untouched, never copies or blanks it", async () => {
    await unlocked();
    await ensureCheckinSet(jk, TODAY, ["M1", "D3", "K2"]);
    await saveAnswer(jk, TODAY, "M1", "device-phone-01", "Pretend phone typing", false); // not moved past there
    renderApp("/journal", TODAY);
    const s = await section();
    expect(await within(s).findByLabelText("Your answer")).toHaveValue("Pretend phone typing");
    await userEvent.click(within(s).getByRole("button", { name: "Skip" }));
    expect(await within(s).findByRole("img", { name: "Question 2 of 3" })).toBeInTheDocument();
    expect((await readCheckinDay(jk, TODAY)).answers.get("M1")).toMatchObject({ answer: "Pretend phone typing", done: true });
    const device = await me();
    const mine = (await db.journal.where("kind").equals("answer").toArray()).filter((r) => r.id.endsWith(`:${device}`));
    expect(mine).toHaveLength(1); // only "moved past", sealed with no text
  });

  it("a check-in left open past midnight stores the new day's questions too", async () => {
    await unlocked();
    const device = await me();
    const view = render(
      <MemoryRouter>
        <DailyCheckIn jk={jk} today="2026-10-28" deviceId={device} />
      </MemoryRouter>,
    );
    await waitFor(async () => expect(await db.journal.get("set:2026-10-28")).toBeTruthy());
    view.rerender(
      <MemoryRouter>
        <DailyCheckIn jk={jk} today="2026-10-29" deviceId={device} />
      </MemoryRouter>,
    );
    await waitFor(async () => expect(await db.journal.get("set:2026-10-29")).toBeTruthy());
    expect(await screen.findByRole("img", { name: /Question 1 of/ })).toBeInTheDocument();
  });

  it("past check-ins open newest first and can be reread", async () => {
    await unlocked();
    await ensureCheckinSet(jk, "2026-10-20", ["E3"]);
    await saveAnswer(jk, "2026-10-20", "E3", "device-phone-01", "Pretend older", true);
    await ensureCheckinSet(jk, "2026-10-27", ["K4", "K2"]);
    await saveAnswer(jk, "2026-10-27", "K4", "device-phone-01", "Pretend newer", true);
    await saveAnswer(jk, "2026-10-27", "K2", "device-phone-01", null, true);
    renderApp("/journal", TODAY);
    await userEvent.click(await screen.findByText("Past check-ins"));
    const days = screen.getAllByText(/^(Tuesday 27 October|Tuesday 20 October)$/);
    expect(days.map((d) => d.textContent)).toEqual(["Tuesday 27 October", "Tuesday 20 October"]);
    await userEvent.click(days[0]!);
    expect(await screen.findByText("Pretend newer")).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
  });

  it("Choose questions: the whole bank with the starters ticked; a choice is saved, sealed and synced", async () => {
    await unlocked();
    renderApp("/journal", TODAY);
    await userEvent.click(await screen.findByText("Choose questions"));
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(61);
    expect(boxes.filter((b) => (b as HTMLInputElement).checked)).toHaveLength(21);
    await userEvent.click(boxes[2]!); // M3, off by default
    await waitFor(async () => expect(await db.journal.get("settings")).toMatchObject({ kind: "settings", fp: jk.fp }));
    expect(await db.pending.get(["journal", "settings"])).toBeTruthy();
  });
});
