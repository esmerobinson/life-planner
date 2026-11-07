import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "../../data/db";
import { readLearned, saveLearned } from "../../data/repo";
import { journalAad, sealJson } from "../../journal/crypto";
import { emptyDb, journalDay } from "../../together/testKit";
import { LearnedToday } from "./LearnedToday";
import { TOGETHER_WORDS as W } from "./wording";

// Earlier "what I learned" versions under the box can be cleared, never silently: put into the
// box ("Add to my words"), or removed after she confirms. Made-up words only.

beforeEach(emptyDb);

const DAY = "2026-11-04";
const MAC = "device-pretend-mac-01";
const PHONE = "device-pretend-phone-1";

async function twoVersions() {
  const { jk } = await journalDay(DAY, {});
  await saveLearned(jk, DAY, MAC, "Pretend Quorrel Mac lesson");
  const id = `learned:${DAY}:${PHONE}`;
  await db.journal.put({ id, kind: "learned", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text: "Pretend Vantry phone lesson", at: Date.now() + 1 }, journalAad(id))) });
  render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
  await screen.findByDisplayValue("Pretend Vantry phone lesson");
  return jk;
}

it("\"Add to my words\": the earlier words go into the box after hers, and that version is replaced; nothing is lost", async () => {
  const jk = await twoVersions();
  await userEvent.click(screen.getByRole("button", { name: W.learnedMerge }));
  const want = "Pretend Vantry phone lesson\n\nPretend Quorrel Mac lesson";
  await waitFor(() => expect(screen.getByLabelText(W.learnedLabel)).toHaveValue(want));
  await waitFor(async () => expect(await readLearned(jk, DAY)).toMatchObject({ text: want, others: [] }));
  expect(screen.queryByText(W.learnedEarlierHere)).toBeNull();
});

it("\"Remove\" asks first; \"Keep them\" changes nothing; confirmed, that version is gone and the box's words stay", async () => {
  const jk = await twoVersions();
  await userEvent.click(screen.getByRole("button", { name: W.learnedRemove }));
  const ask = screen.getByRole("group", { name: W.learnedRemoveAsk });
  await userEvent.click(within(ask).getByRole("button", { name: W.learnedRemoveNo }));
  expect((await readLearned(jk, DAY)).others).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: W.learnedRemove }));
  await userEvent.click(within(screen.getByRole("group", { name: W.learnedRemoveAsk })).getByRole("button", { name: W.learnedRemoveYes }));
  await waitFor(async () => expect(await readLearned(jk, DAY)).toMatchObject({ text: "Pretend Vantry phone lesson", others: [] }));
  await waitFor(() => expect(screen.queryByText("Pretend Quorrel Mac lesson")).toBeNull());
  expect(screen.getByDisplayValue("Pretend Vantry phone lesson")).toBeInTheDocument();
});
