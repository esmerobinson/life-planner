import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { db } from "../../data/db";
import { readLearned, saveLearned } from "../../data/repo";
import { journalAad, sealJson } from "../../journal/crypto";
import { emptyDb, journalDay } from "../../together/testKit";
import { LearnedToday } from "./LearnedToday";
import { TOGETHER_WORDS as W } from "./wording";

// Testing session (Together link), 2026-11-05. "What I learned today" written on two devices the
// same day: each device has its own row, and the box shows the NEWEST device's words. On the
// device whose words are older, the box therefore holds the other device's words, and her own
// show under "Also written on another device". When she then adds to the box there, the save
// rewrites THIS device's row with the other device's words plus hers: her own earlier words are
// gone from every row. Made-up words only.

beforeEach(emptyDb);

const DAY = "2026-11-04";
const MAC = "device-pretend-mac-01";
const PHONE = "device-pretend-phone-1";

it("adding to the box on the device with the older words keeps that device's own earlier words", async () => {
  const { jk } = await journalDay(DAY, {});
  await saveLearned(jk, DAY, MAC, "Pretend Quorrel Mac lesson");
  // The phone's words, written later the same day, arrive by sync.
  const id = `learned:${DAY}:${PHONE}`;
  await db.journal.put({ id, kind: "learned", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text: "Pretend Vantry phone lesson", at: Date.now() + 1 }, journalAad(id))) });

  render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
  const field = await screen.findByDisplayValue("Pretend Vantry phone lesson");
  expect(screen.getByText(W.learnedOther)).toBeInTheDocument();
  expect(screen.getByText("Pretend Quorrel Mac lesson")).toBeInTheDocument();

  // She adds a line in the box on the Mac and clicks away.
  fireEvent.change(field, { target: { value: "Pretend Vantry phone lesson. Pretend Ellowby added on the Mac." } });
  fireEvent.blur(field);
  await waitFor(async () => expect((await readLearned(jk, DAY)).text).toBe("Pretend Vantry phone lesson. Pretend Ellowby added on the Mac."));

  const day = await readLearned(jk, DAY);
  expect([day.text, ...day.others.map((o) => o.text)], "the Mac's own earlier words are gone").toContain("Pretend Quorrel Mac lesson");
});

it("the device's own words are never labelled as written on another device", async () => {
  const { jk } = await journalDay(DAY, {});
  await saveLearned(jk, DAY, MAC, "Pretend Quorrel Mac lesson");
  const id = `learned:${DAY}:${PHONE}`;
  await db.journal.put({ id, kind: "learned", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text: "Pretend Vantry phone lesson", at: Date.now() + 1 }, journalAad(id))) });
  render(<LearnedToday jk={jk} today={DAY} deviceId={MAC} />);
  await screen.findByDisplayValue("Pretend Vantry phone lesson");
  // On the Mac, the Mac's words sit under "Also written on another device".
  const other = screen.getByText(W.learnedOther).parentElement!;
  expect(other.textContent, "the Mac's own words are shown as another device's").not.toContain("Pretend Quorrel Mac lesson");
});
