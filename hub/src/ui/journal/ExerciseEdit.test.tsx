import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import {
  importExerciseCards, listExerciseEntries, readExerciseEntry, saveExerciseEdit, saveExerciseMark, submitExerciseEntry,
} from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { checkCardFile } from "../../journal/exercise";
import { getDeviceId } from "../../sync/engine";
import { FAKE_CARD_FILE } from "../../test/exerciseCards";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { renderApp } from "../../test/renderApp";
import { EARLIER_VERSION } from "./ResponseView";

// Review I4: today's submitted answer can be changed ("Edit"); the change is a new version and
// the one it changes stays, as "Earlier version". A card finished on another device while she
// types here stays hers to finish. Fictional cards and words only.

const TODAY = "2026-10-30";
const SET = checkCardFile(FAKE_CARD_FILE)!;
const CARD1 = { id: "day-1", day: 1, theme: "Pretend weather", legacy: true };
const FIRST = "Pretend first answer about the weather";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-exercise-edit-passphrase");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
  await confirmedDevice(db, jk);
  await importExerciseCards(jk, SET, "2026-10-01");
});
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 150));
  vi.useRealTimers();
});

const section = () => screen.findByRole("region", { name: "Mental health exercise" });

it("an edit is a new submitted version; the answer it changed stays as the earlier version", async () => {
  const me = await getDeviceId(db);
  await submitExerciseEntry(jk, TODAY, me, CARD1, FIRST);
  await new Promise((r) => setTimeout(r, 5));
  await saveExerciseEdit(jk, TODAY, me, CARD1, "Pretend changed answer");
  const [e] = (await listExerciseEntries(jk, "2026-10-31")).entries;
  expect(e).toMatchObject({ text: "Pretend changed answer", submitted: true });
  expect(e!.others).toEqual([expect.objectContaining({ text: FIRST, submitted: true, earlier: true })]);
  expect((await readExerciseEntry(jk, TODAY, CARD1, me)).entry).toMatchObject({ text: "Pretend changed answer", saved: true });
});

it("Edit on today's answer (See what you wrote): Save shows the new words, the earlier ones under them", async () => {
  await submitExerciseEntry(jk, TODAY, await getDeviceId(db), CARD1, FIRST);
  renderApp("/journal", TODAY);
  const s = await section();
  await userEvent.click(await within(s).findByRole("button", { name: "See what you wrote" }));
  const mine = await within(s).findByRole("list", { name: "Your responses" });
  await userEvent.click(within(mine).getByRole("button", { name: "Edit" }));
  const box = await within(mine).findByRole("textbox", { name: "Your response" });
  expect(box).toHaveValue(FIRST);
  expect(within(mine).getByRole("button", { name: "Save" })).toBeDisabled(); // nothing changed yet
  await userEvent.type(box, ", and a pretend second thought");
  await userEvent.click(within(mine).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(within(mine).queryByRole("textbox")).toBeNull());
  expect(await within(mine).findByText(new RegExp(`^${EARLIER_VERSION} · `), {}, { timeout: 3000 })).toBeInTheDocument();
  expect(within(mine).getByText(`${FIRST}, and a pretend second thought`)).toBeInTheDocument();
  expect(within(mine).getByText(FIRST)).toBeInTheDocument();
  expect(within(mine).queryByText(/^Unsent draft/)).toBeNull(); // the words she saved aren't listed twice
});

it("an earlier day's answer has no Edit", async () => {
  await submitExerciseEntry(jk, "2026-10-29", await getDeviceId(db), CARD1, FIRST);
  renderApp("/journal", TODAY);
  const s = await section();
  await userEvent.click(await within(s).findByText("Past exercises"));
  const item = within(s).getByRole("list", { name: "Past exercises" }).querySelector("li")!;
  await userEvent.click(within(item).getByText(/Pretend weather/));
  expect(within(item).getByText(FIRST)).toBeInTheDocument();
  expect(within(item).queryByRole("button", { name: "Edit" })).toBeNull();
});

it("the card finished on another device while she types here: it stays, with her words, until she submits", async () => {
  renderApp("/journal", TODAY);
  const s = await section();
  const card = await within(s).findByRole("article", { name: "Today's card" });
  const box = await within(card).findByRole("textbox", { name: "Your response" });
  await userEvent.type(box, "Pretend words typed on the Mac");
  await new Promise((r) => setTimeout(r, 1000)); // autosaved
  // The phone submits the same card (its answer, and its done mark), and that arrives here.
  await submitExerciseEntry(jk, TODAY, "device-phone-01", CARD1, "Pretend phone answer");
  await saveExerciseMark(jk, TODAY, "device-phone-01", "day-1", true);
  await new Promise((r) => setTimeout(r, 600));
  const still = within(s).getByRole("article", { name: "Today's card" });
  expect(within(still).getByRole("textbox", { name: "Your response" })).toHaveValue("Pretend words typed on the Mac");
  await userEvent.type(within(still).getByRole("textbox", { name: "Your response" }), ", more");
  await userEvent.click(within(still).getByRole("button", { name: "Submit" }));
  await within(s).findByRole("article", { name: /Next card/ }, { timeout: 5000 });
  const [e] = (await listExerciseEntries(jk, "2026-10-31")).entries;
  expect([e!.text, ...e!.others.map((o) => o.text)].sort()).toEqual(["Pretend phone answer", "Pretend words typed on the Mac, more"].sort());
}, 15_000);
