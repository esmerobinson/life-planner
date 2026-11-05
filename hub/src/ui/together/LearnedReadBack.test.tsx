import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "../../data/db";
import { cardRef, importExerciseCards, saveLearned, submitExerciseEntry } from "../../data/repo";
import { parseCardFile } from "../../journal/exercise";
import { getDeviceId } from "../../sync/engine";
import { FAKE_CARD_TEXT_V2 } from "../../test/exerciseCards";
import { confirmedDevice, keyFor } from "../../test/journalKey";
import { findReadBackTile, openReadBackPart } from "../../test/readBack";
import { renderApp } from "../../test/renderApp";
import { TOGETHER_WORDS as W } from "./wording";

// Bug #45: "what I learned today" is in Read back, inside that day's Mental health exercise
// (placement is provisional, for the Design session). Fictional words only.

const TODAY = "2026-11-05";
const SET = parseCardFile(FAKE_CARD_TEXT_V2)!;
const WEATHER = SET.cards[1]!;

beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
  await confirmedDevice(db, await keyFor("fake-journal-learned-readback"));
});
afterEach(() => cleanup());

it("a day's learned words show inside that day's exercise entry; a day with words and no card has its own entry", async () => {
  const jk = await keyFor("fake-journal-learned-readback");
  const me = await getDeviceId(db);
  await importExerciseCards(jk, SET, "2026-11-01");
  await submitExerciseEntry(jk, "2026-11-04", me, cardRef(WEATHER), "Pretend weather answer");
  await saveLearned(jk, "2026-11-04", me, "Pretend Larkspin: a wave passes");
  await saveLearned(jk, "2026-11-02", me, "Pretend Mossfold: learned on a day without a card");
  renderApp("/journal/read-back", TODAY);
  expect(await findReadBackTile("Mental health exercise")).toHaveTextContent(/^Mental health exercise2Last: Wednesday 4 November$/);
  const part = await openReadBackPart("Mental health exercise");
  const items = within(part).getAllByRole("listitem");
  expect(items).toHaveLength(2);
  await userEvent.click(within(items[0]!).getByText(/^Wednesday 4 November · /));
  expect(within(items[0]!).getByText("Pretend weather answer")).toBeVisible();
  expect(within(items[0]!).getByText(W.learnedReadBack)).toBeVisible();
  expect(within(items[0]!).getByText("Pretend Larkspin: a wave passes")).toBeVisible();
  await userEvent.click(within(items[1]!).getByText("Monday 2 November · What I learned"));
  expect(within(items[1]!).getByText("Pretend Mossfold: learned on a day without a card")).toBeVisible();
  expect(screen.queryAllByText(W.learnedReadBack)).toHaveLength(2);
});
