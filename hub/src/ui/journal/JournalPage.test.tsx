import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import { finishMorningPage, readCheckin, readMorningDay, saveCheckin } from "../../data/repo";
import { deriveJournalKey } from "../../journal/crypto";
import { JOURNAL_KEY_META, loadJournalKey } from "../../journal/keyStore";
import { PROMPT_BY_ID } from "../../journal/prompts";
import { saveSyncSettings } from "../../sync/engine";
import { deriveToken } from "../../sync/token";
import { renderApp } from "../../test/renderApp";

// The Journal page (journal brief): unlock, the star calendar, Write now, Read back, the
// check-in. Fictional passphrase and words only.

const PASS = "fake-journal-passphrase-for-tests";
const TODAY = "2026-10-28";
const SECRET = "Pretend secret morning words about a pretend dream";
let key: CryptoKey;
let token: string;
beforeAll(async () => {
  key = await deriveJournalKey(PASS);
  token = await deriveToken(PASS);
});

beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
});
afterEach(() => vi.useRealTimers());

async function unlocked() {
  await db.syncMeta.put({ key: JOURNAL_KEY_META, value: { key, tokenVersion: null, id: "test" } });
}

describe("locked", () => {
  it("without the key: only Unlock journal; entries waiting here are not shown or written", async () => {
    await finishMorningPage(key, "2026-10-27", SECRET);
    const before = await db.journal.toArray();
    renderApp("/journal", TODAY);
    expect(await screen.findByRole("heading", { name: "Unlock journal" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Morning pages" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Daily check-in" })).toBeNull();
    expect(await db.journal.toArray()).toEqual(before);
  });

  it("a wrong passphrase is refused and nothing is stored; the right one opens the journal", async () => {
    await saveSyncSettings(db, { serverUrl: "https://sync.example.test", token });
    renderApp("/journal", TODAY);
    const field = await screen.findByLabelText("Sync passphrase");
    await userEvent.type(field, "fake-wrong-passphrase");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent("isn't the sync passphrase");
    expect(await loadJournalKey(db)).toBeUndefined();
    expect(field).toHaveValue(""); // not kept in the field either
    await userEvent.type(field, PASS);
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByRole("heading", { name: "Morning pages" }, { timeout: 5000 })).toBeInTheDocument();
    expect(await loadJournalKey(db)).toBeInstanceOf(CryptoKey);
  });

  it("without sync set up, it says to set up sync first", async () => {
    renderApp("/journal", TODAY);
    await userEvent.type(await screen.findByLabelText("Sync passphrase"), PASS);
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    const alert = await screen.findByRole("alert", {}, { timeout: 5000 });
    expect(alert).toHaveTextContent("Set up sync on this device first");
    expect(within(alert).getByRole("link", { name: "Sync" })).toHaveAttribute("href", "/sync");
  });
});

describe("morning pages", () => {
  it("the star calendar: a star on each done day, today outlined, the streak line", async () => {
    await unlocked();
    for (const d of ["2026-10-02", "2026-10-26", "2026-10-27"]) await finishMorningPage(key, d, "Pretend");
    renderApp("/journal", TODAY);
    const cal = await screen.findByRole("group", { name: "Morning pages calendar" });
    await waitFor(() => expect(cal.querySelectorAll(".journal-day.on")).toHaveLength(3));
    expect(cal.querySelector('[data-date="2026-10-28"]')).toHaveClass("today");
    expect(cal.querySelector('[data-date="2026-10-28"]')).not.toHaveClass("on");
    expect(screen.getByText("2 days in a row · 3 this month")).toBeInTheDocument();
    expect(screen.getByText(/Three pages, longhand if you can/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("September")).toBeInTheDocument();
    expect(cal.querySelectorAll(".journal-day.on")).toHaveLength(0);
  });

  it("Write now: the draft saves itself and reopens; I'm done gives the star and the words are never shown again", async () => {
    await unlocked();
    renderApp("/journal", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Write now" }));
    const box = screen.getByLabelText("Today's morning page");
    await userEvent.type(box, "Pretend draft words");
    expect(screen.getByText("3 of 750 words")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "3 of 750 words" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(async () => expect((await readMorningDay(key, TODAY)).draft).toBe("Pretend draft words"));
    // Reopens with the draft.
    await userEvent.click(await screen.findByRole("button", { name: "Write now" }));
    expect(screen.getByLabelText("Today's morning page")).toHaveValue("Pretend draft words");
    await userEvent.type(screen.getByLabelText("Today's morning page"), " and more");
    await userEvent.click(screen.getByRole("button", { name: "I'm done" }));
    expect(await screen.findByText("Done for today")).toBeInTheDocument();
    await waitFor(async () => expect(await readMorningDay(key, TODAY)).toMatchObject({ done: true, draft: "", pages: 1 }));
    expect(document.body.textContent).not.toContain("Pretend draft");
    // A further page starts empty and is added to the same day.
    await userEvent.click(screen.getByRole("button", { name: "Write now" }));
    expect(screen.getByLabelText("Today's morning page")).toHaveValue("");
    expect(document.body.innerHTML).not.toContain("Pretend draft");
  });

  it("Read back: under 4 weeks only 'Opens on', no words; from day 28 the page opens read-only", async () => {
    await unlocked();
    await finishMorningPage(key, "2026-10-01", SECRET);
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
    expect(screen.queryByRole("textbox", { name: /morning page/ })).toBeNull();
  });

  it("an entry that won't open on this device says so and offers nothing that would overwrite it", async () => {
    await finishMorningPage(await deriveJournalKey("fake-other-passphrase"), TODAY, "Pretend");
    await unlocked();
    renderApp("/journal", TODAY);
    expect(await screen.findByText("Can't open this entry on this device")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Write now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add photo" })).toBeNull();
  });

  it("Add photo opens the camera / a picture picker", async () => {
    await unlocked();
    renderApp("/journal", TODAY);
    await screen.findByRole("button", { name: "Add photo" });
    const input = screen.getByLabelText("Photo of today's pages");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).toHaveAttribute("capture", "environment");
  });
});

describe("daily check-in", () => {
  it("three questions one at a time: dots, skill line, Skip, Next, Finish, then Checked in for today", async () => {
    await unlocked();
    renderApp("/journal", TODAY);
    const section = await screen.findByRole("region", { name: "Daily check-in" });
    const q = () => within(section).getByText((_, el) => el?.classList.contains("journal-q") ?? false);
    expect(await within(section).findByRole("img", { name: "Question 1 of 3" })).toBeInTheDocument();
    const first = q().textContent;
    await userEvent.type(within(section).getByLabelText("Your answer"), "Pretend first answer");
    await userEvent.click(within(section).getByRole("button", { name: "Next →" }));
    expect(await within(section).findByRole("img", { name: "Question 2 of 3" })).toBeInTheDocument();
    expect(q().textContent).not.toBe(first);
    await userEvent.click(within(section).getByRole("button", { name: "Skip" }));
    expect(await within(section).findByRole("img", { name: "Question 3 of 3" })).toBeInTheDocument();
    await userEvent.type(within(section).getByLabelText("Your answer"), "Pretend kind answer");
    await userEvent.click(within(section).getByRole("button", { name: "Finish" }));
    expect(await within(section).findByText("Checked in for today")).toBeInTheDocument();
    expect(within(section).getByText("Kind to yourself today? That counts.")).toBeInTheDocument();
    await waitFor(async () => {
      const r = await readCheckin(key, TODAY);
      expect(r).toMatchObject({ state: "ok", entry: { answers: ["Pretend first answer", null, "Pretend kind answer"], finished: true } });
    });
    // The stored rows hold no plaintext.
    expect(JSON.stringify(await db.journal.toArray())).not.toContain("Pretend");
  });

  it("reopening the same day shows the answers, editable, not new questions", async () => {
    await unlocked();
    await saveCheckin(key, TODAY, { prompts: ["M1", "D3", "K2"], answers: ["Pretend seen", null, "Pretend kind"], step: 3, finished: true });
    renderApp("/journal", TODAY);
    const section = await screen.findByRole("region", { name: "Daily check-in" });
    expect(await within(section).findByText("Checked in for today")).toBeInTheDocument();
    const answers = section.querySelector<HTMLElement>(".journal-answers")!;
    expect(within(answers).getByText(PROMPT_BY_ID.get("M1")!.text)).toBeInTheDocument();
    expect(within(answers).getByText("Observe · Workbook p. 134")).toBeInTheDocument();
    const boxes = within(answers).getAllByLabelText("Your answer");
    expect(boxes.map((b) => (b as HTMLTextAreaElement).value)).toEqual(["Pretend seen", "", "Pretend kind"]);
    await userEvent.type(boxes[1]!, "Pretend added later");
    act(() => boxes[1]!.blur());
    await waitFor(async () =>
      expect(await readCheckin(key, TODAY)).toMatchObject({ entry: { answers: ["Pretend seen", "Pretend added later", "Pretend kind"] } }),
    );
  });

  it("past check-ins open newest first and can be reread", async () => {
    await unlocked();
    await saveCheckin(key, "2026-10-20", { prompts: ["E3"], answers: ["Pretend older"], step: 1, finished: true });
    await saveCheckin(key, "2026-10-27", { prompts: ["K4", "K2"], answers: ["Pretend newer", null], step: 2, finished: true });
    renderApp("/journal", TODAY);
    await userEvent.click(await screen.findByText("Past check-ins"));
    const days = screen.getAllByText(/^(Tuesday 27 October|Tuesday 20 October)$/);
    expect(days.map((d) => d.textContent)).toEqual(["Tuesday 27 October", "Tuesday 20 October"]);
    await userEvent.click(days[0]!);
    expect(await screen.findByText("Pretend newer")).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
  });

  it("Choose questions: the whole bank with the starters ticked; a choice is saved on this device", async () => {
    await unlocked();
    renderApp("/journal", TODAY);
    await userEvent.click(await screen.findByText("Choose questions"));
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(61);
    expect(boxes.filter((b) => (b as HTMLInputElement).checked)).toHaveLength(21);
    await userEvent.click(boxes[2]!); // M3, off by default
    await waitFor(async () => expect(((await db.syncMeta.get("journalPrompts"))!.value as string[])).toContain("M3"));
  });
});
