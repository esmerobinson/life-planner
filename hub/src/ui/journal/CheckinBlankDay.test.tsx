import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../../data/db";
import { ensureCheckinSet, moveAnswerOn, readCheckinDay, saveAnswer } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { PROMPT_BY_ID } from "../../journal/prompts";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";
import { DailyCheckIn, EDIT_ANSWERS, NO_ANSWER_SAVED, SAVE_ANSWERS } from "./DailyCheckIn";

// Bug #40 (2026-11-05): a finished check-in whose answers are all blank showed "Checked in for
// today" with no questions, no boxes and no Edit, so she couldn't write them again after #39
// blanked them. Esme: everything she completes in the Journal is saved and easy to revisit; a
// finished check-in shows her answers and an option to edit. Fictional words only.

const TODAY = "2026-10-28";
const IDS = ["M1", "D3", "K2"];
const WORDS = ["Pretend: the kettle, the rain, my socks", "Pretend: I asked for help", "Pretend: a warm bath"];
const ME = "device-this-one-01";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-checkin-blank-day-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
});
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 150)); // a closing view's saves land first
  vi.useRealTimers();
});

const text = (id: string) => PROMPT_BY_ID.get(id)!.text;
const shown = (scope: HTMLElement) =>
  [...scope.querySelectorAll<HTMLElement>(".journal-answers > li .journal-q")].map((q) => q.textContent);
function checkIn(deviceId = ME) {
  return render(
    <MemoryRouter>
      <DailyCheckIn jk={jk} today={TODAY} deviceId={deviceId} />
    </MemoryRouter>,
  );
}

it("a finished day with every answer blank (#39: Next saved them empty) shows every question, 'No answer saved', and Edit", async () => {
  await ensureCheckinSet(jk, TODAY, IDS);
  for (const id of IDS) await saveAnswer(jk, TODAY, id, ME, null, true);
  checkIn();
  await screen.findByText("Checked in for today");
  const answers = document.querySelector<HTMLElement>(".journal-answers")!;
  expect(shown(answers)).toEqual(IDS.map(text));
  expect(within(answers).getAllByText(NO_ANSWER_SAVED)).toHaveLength(3);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByRole("button", { name: EDIT_ANSWERS })).toBeInTheDocument();
});

it("Edit on an all-blank day opens a box for every question; Save keeps her answers, and they survive a reload", async () => {
  await ensureCheckinSet(jk, TODAY, IDS);
  for (const id of IDS) await saveAnswer(jk, TODAY, id, ME, null, true);
  const view = checkIn();
  await screen.findByText("Checked in for today");
  await userEvent.click(screen.getByRole("button", { name: EDIT_ANSWERS }));
  const boxes = screen.getAllByRole("textbox", { name: "Your answer" });
  expect(boxes).toHaveLength(3);
  expect(boxes.map((b) => (b as HTMLTextAreaElement).value)).toEqual(["", "", ""]);
  for (const [i, b] of boxes.entries()) await userEvent.type(b, WORDS[i]!);
  await userEvent.click(screen.getByRole("button", { name: SAVE_ANSWERS }));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getAllByLabelText("Your answer").map((a) => a.textContent)).toEqual(WORDS);
  await waitFor(async () => {
    const day = await readCheckinDay(jk, TODAY);
    expect(IDS.map((id) => day.answers.get(id)?.answer)).toEqual(WORDS);
  });
  view.unmount();
  checkIn(); // the reload
  await screen.findByText("Checked in for today");
  await waitFor(() => expect(screen.getAllByLabelText("Your answer").map((a) => a.textContent)).toEqual(WORDS));
  expect(screen.queryByText(NO_ANSWER_SAVED)).toBeNull();
}, 20_000);

it("a mix: an answer, a Skip and a blank Next: the skipped one stays hidden, the blank one shows; Edit opens the two shown", async () => {
  await ensureCheckinSet(jk, TODAY, IDS);
  renderApp("/journal/check-in", TODAY);
  const s = await screen.findByRole("region", { name: "Daily check-in" });
  await within(s).findByRole("img", { name: "Question 1 of 3" });
  await userEvent.type(within(s).getByLabelText("Your answer"), WORDS[0]!);
  await userEvent.click(within(s).getByRole("button", { name: "Next →" }));
  await within(s).findByRole("img", { name: "Question 2 of 3" });
  await userEvent.click(within(s).getByRole("button", { name: "Skip" }));
  await within(s).findByRole("img", { name: "Question 3 of 3" });
  await userEvent.click(within(s).getByRole("button", { name: "Finish" })); // left blank
  await within(s).findByText("Checked in for today");
  const answers = s.querySelector<HTMLElement>(".journal-answers")!;
  await waitFor(() => expect(shown(answers)).toEqual([text("M1"), text("K2")]));
  expect(within(answers).getByLabelText("Your answer")).toHaveTextContent(WORDS[0]!);
  expect(within(answers).getAllByText(NO_ANSWER_SAVED)).toHaveLength(1);
  await userEvent.click(within(s).getByRole("button", { name: EDIT_ANSWERS }));
  const boxes = within(s).getAllByRole("textbox", { name: "Your answer" });
  expect(boxes.map((b) => (b as HTMLTextAreaElement).value)).toEqual([WORDS[0], ""]);
});

it("Skip with words typed keeps them and shows them; Skip on an empty box is stored as skipped", async () => {
  await ensureCheckinSet(jk, TODAY, ["M1", "D3"]);
  renderApp("/journal/check-in", TODAY);
  const s = await screen.findByRole("region", { name: "Daily check-in" });
  await within(s).findByRole("img", { name: "Question 1 of 2" });
  await userEvent.type(within(s).getByLabelText("Your answer"), WORDS[0]!);
  await userEvent.click(within(s).getByRole("button", { name: "Skip" }));
  await within(s).findByRole("img", { name: "Question 2 of 2" });
  await userEvent.click(within(s).getByRole("button", { name: "Skip" }));
  await within(s).findByText("Checked in for today");
  const day = await readCheckinDay(jk, TODAY);
  expect(day.answers.get("M1")).toMatchObject({ answer: WORDS[0], done: true });
  expect(day.answers.get("M1")?.skipped).toBeFalsy();
  expect(day.answers.get("D3")).toMatchObject({ answer: null, done: true, skipped: true });
  await waitFor(() => expect(shown(s.querySelector<HTMLElement>(".journal-answers")!)).toEqual([text("M1")]));
});

it("Skip on a box already saved empty on this device marks it skipped; Next on one doesn't", async () => {
  await ensureCheckinSet(jk, TODAY, ["M1", "D3"]);
  await saveAnswer(jk, TODAY, "M1", ME, "", false); // typed, then cleared: saved empty, not moved past
  await saveAnswer(jk, TODAY, "D3", ME, "", false);
  await moveAnswerOn(jk, TODAY, "M1", ME, { skip: true });
  await moveAnswerOn(jk, TODAY, "D3", ME);
  const day = await readCheckinDay(jk, TODAY);
  expect(day.answers.get("M1")).toMatchObject({ answer: null, done: true, skipped: true });
  expect(day.answers.get("D3")?.skipped).toBeFalsy();
});

it("every question skipped: none shows, but Edit is still there and opens a box for each", async () => {
  await ensureCheckinSet(jk, TODAY, IDS);
  for (const id of IDS) await moveAnswerOn(jk, TODAY, id, ME, { skip: true });
  checkIn();
  await screen.findByText("Checked in for today");
  expect(document.querySelectorAll(".journal-answers > li")).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: EDIT_ANSWERS }));
  expect(screen.getAllByRole("textbox", { name: "Your answer" })).toHaveLength(3);
});

it("skipped on one device but left blank by Next on another: it shows (when unsure, show the question)", async () => {
  await ensureCheckinSet(jk, TODAY, ["M1"]);
  await moveAnswerOn(jk, TODAY, "M1", "device-phone-02", { skip: true });
  await saveAnswer(jk, TODAY, "M1", ME, null, true);
  expect((await readCheckinDay(jk, TODAY)).answers.get("M1")?.skipped).toBeFalsy();
  checkIn();
  await screen.findByText("Checked in for today");
  expect(shown(document.querySelector<HTMLElement>(".journal-answers")!)).toEqual([text("M1")]);
  expect(screen.getByText(NO_ANSWER_SAVED)).toBeInTheDocument();
});

it("a cleared answer (Edit, emptied on purpose) still shows its question after a reload", async () => {
  await ensureCheckinSet(jk, TODAY, ["M1"]);
  await saveAnswer(jk, TODAY, "M1", ME, WORDS[0]!, true);
  await saveAnswer(jk, TODAY, "M1", ME, "", true, { session: "pretend1" });
  checkIn();
  await screen.findByText("Checked in for today");
  expect(shown(document.querySelector<HTMLElement>(".journal-answers")!)).toEqual([text("M1")]);
  expect(screen.getByText(NO_ANSWER_SAVED)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: EDIT_ANSWERS })).toBeInTheDocument();
});

it("Past check-ins list a day whose answers were lost, with No answer saved; a question skipped on purpose stays hidden (Esme, 2026-11-06)", async () => {
  await ensureCheckinSet(jk, "2026-10-20", ["M1", "D3"]);
  for (const id of ["M1", "D3"]) await saveAnswer(jk, "2026-10-20", id, ME, null, true); // lost (the old Next bug)
  await ensureCheckinSet(jk, "2026-10-21", ["M1", "D3"]);
  await saveAnswer(jk, "2026-10-21", "M1", ME, "Pretend answer on the 21st", true);
  await saveAnswer(jk, "2026-10-21", "D3", ME, null, true, undefined, true); // Skip pressed
  await ensureCheckinSet(jk, TODAY, ["M1"]);
  await saveAnswer(jk, TODAY, "M1", ME, "Pretend today", true);
  checkIn();
  await screen.findByText("Checked in for today");
  const past = screen.getByText("Past check-ins").closest("details")!;
  const days = [...past.querySelectorAll(".journal-past > li")] as HTMLElement[];
  expect(days).toHaveLength(2);
  expect(within(days[0]!).getByText("Pretend answer on the 21st")).toBeInTheDocument();
  expect(within(days[0]!).queryByText(text("D3"))).toBeNull();
  expect(within(days[1]!).getAllByText(NO_ANSWER_SAVED)).toHaveLength(2);
});
