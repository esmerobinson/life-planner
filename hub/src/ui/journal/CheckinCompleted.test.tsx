import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../../data/db";
import { ensureCheckinSet, readCheckinDay, saveAnswer } from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { PROMPT_BY_ID } from "../../journal/prompts";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";
import { DailyCheckIn } from "./DailyCheckIn";

// Esme, 2026-11-04: "why when i finish a daily check-in do i get this screen with the same
// exercises again in there; i think i should just see a completed check in with my answers,
// maybe an option to edit and then a past check ins part". Fictional words only.

const TODAY = "2026-10-28";
const WORDS = ["Pretend: the kettle, the rain, my socks", "Pretend: I asked for help\nand it went fine", "Pretend: a warm bath"];
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-checkin-completed-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const section = () => screen.findByRole("region", { name: "Daily check-in" });
const text = (id: string) => PROMPT_BY_ID.get(id)!.text;

async function answerAll(s: HTMLElement, words: (string | null)[]) {
  for (let i = 0; i < words.length; i++) {
    await within(s).findByRole("img", { name: `Question ${i + 1} of ${words.length}` });
    const w = words[i];
    if (w === null) {
      await userEvent.click(within(s).getByRole("button", { name: "Skip" }));
      continue;
    }
    await userEvent.type(within(s).getByLabelText("Your answer"), w);
    await userEvent.click(within(s).getByRole("button", { name: i === words.length - 1 ? "Finish" : "Next →" }));
  }
}

it("finished: 'Checked in for today', each question with her answer exactly as typed, read-only; no boxes", async () => {
  await ensureCheckinSet(jk, TODAY, ["M1", "D3", "K2"]);
  renderApp("/journal/check-in", TODAY);
  const s = await section();
  await answerAll(s, WORDS);
  expect(await within(s).findByText("Checked in for today")).toBeInTheDocument();
  const answers = s.querySelector<HTMLElement>(".journal-answers")!;
  await waitFor(() => expect(within(answers).getAllByLabelText("Your answer").map((a) => a.textContent)).toEqual(WORDS));
  expect(within(s).queryByRole("textbox")).toBeNull();
  for (const id of ["M1", "D3", "K2"]) expect(within(answers).getByText(text(id))).toBeInTheDocument();
  expect(within(s).getByRole("button", { name: "Edit" })).toBeInTheDocument();
});

it("a skipped question isn't shown in the finished check-in", async () => {
  await ensureCheckinSet(jk, TODAY, ["M1", "D3", "K2"]);
  renderApp("/journal/check-in", TODAY);
  const s = await section();
  await answerAll(s, [WORDS[0]!, null, WORDS[2]!]);
  const answers = (await within(s).findByText("Checked in for today")) && s.querySelector<HTMLElement>(".journal-answers")!;
  await waitFor(() => expect(within(answers).getAllByLabelText("Your answer").map((a) => a.textContent)).toEqual([WORDS[0], WORDS[2]]));
  expect(within(answers).queryByText(text("D3"))).toBeNull();
});

it("Edit turns the answers back into boxes; Save keeps the change and shows it read-only again", async () => {
  await ensureCheckinSet(jk, TODAY, ["M1", "D3", "K2"]);
  const me = "device-this-one-01";
  for (const [i, id] of ["M1", "D3", "K2"].entries()) await saveAnswer(jk, TODAY, id, me, WORDS[i]!, true);
  render(
    <MemoryRouter>
      <DailyCheckIn jk={jk} today={TODAY} deviceId={me} />
    </MemoryRouter>,
  );
  await screen.findByText("Checked in for today");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  const boxes = screen.getAllByRole("textbox", { name: "Your answer" });
  expect(boxes.map((b) => (b as HTMLTextAreaElement).value)).toEqual(WORDS);
  await userEvent.type(boxes[2]!, ", and pretend tea");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getAllByLabelText("Your answer").map((a) => a.textContent)).toEqual([WORDS[0], WORDS[1], `${WORDS[2]}, and pretend tea`]);
  await waitFor(async () => expect((await readCheckinDay(jk, TODAY)).answers.get("K2")?.answer).toBe(`${WORDS[2]}, and pretend tea`));
});

it("Past check-ins: the latest few, then See all; Choose questions closed at the bottom", async () => {
  const me = "device-this-one-01";
  for (const d of ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]) {
    await ensureCheckinSet(jk, d, ["M1"]);
    await saveAnswer(jk, d, "M1", me, `Pretend answer on ${d}`, true);
  }
  await ensureCheckinSet(jk, TODAY, ["M1"]);
  await saveAnswer(jk, TODAY, "M1", me, "Pretend today", true);
  render(
    <MemoryRouter>
      <DailyCheckIn jk={jk} today={TODAY} deviceId={me} />
    </MemoryRouter>,
  );
  await screen.findByText("Checked in for today");
  const past = screen.getByText("Past check-ins").closest("details")!;
  expect(within(past).getAllByRole("listitem").filter((li) => li.parentElement?.classList.contains("journal-past"))).toHaveLength(3);
  expect(within(past).getByRole("link", { name: "See all" })).toHaveAttribute("href", "/journal/read-back");
  const choose = screen.getByText("Choose questions").closest("details")!;
  expect(choose.open).toBe(false);
  expect(past.compareDocumentPosition(choose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("the 3am day: finished at 01:30, it is the evening before's check-in that shows as done", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 29, 1, 30)); // still the 28th's app-day
  await ensureCheckinSet(jk, TODAY, ["M1", "D3", "K2"]);
  render(
    <MemoryRouter>
      <DailyCheckIn jk={jk} today={TODAY} deviceId="device-this-one-01" />
    </MemoryRouter>,
  );
  const s = document.body;
  await answerAll(s, WORDS);
  expect(await screen.findByText("Checked in for today")).toBeInTheDocument();
  expect((await readCheckinDay(jk, TODAY)).answers.get("K2")).toMatchObject({ answer: WORDS[2], done: true });
  expect(await db.journal.where("date").equals("2026-10-29").count()).toBe(0);
});
