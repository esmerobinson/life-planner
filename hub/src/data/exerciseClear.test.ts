import { vi } from "vitest";
import { db } from "./db";
import { listExerciseEntries, readExerciseEntry, saveExerciseDraft, saveExerciseEdit, submitExerciseEntry } from "./repo";
import { journalId } from "./validate";
import { exerciseCardIdKey, journalAad, sealJson, type JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";

// Bug #19's data half (re-review m3): she clears her submitted answer to rewrite it. The box
// opens on this device's own draft when it is the newest row, even emptied, so the old words
// never come back into it (on a re-read, or when the box opens again later). Read back still
// shows what she submitted. And an answer from another device is never called her "Earlier
// version" (re-review m1). Fictional words only.

const DAY = "2026-11-04";
const ME = "device-mac-0001";
const PHONE = "d1b2c3d4-0000-4000-8000-e0163b4f8a2c"; // a device id whose last group starts with "e"
const CARD = { id: "pretend-ch1-naming", day: 1, theme: "Pretend naming", legacy: false };
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-journal-clear");
});
let clock = 1_800_000_000_000;
beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock++);
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
  await confirmedDevice(db, jk);
});
afterEach(() => vi.restoreAllMocks());

it("cleared after Submit: the box (this device) opens empty; Read back still has what was submitted", async () => {
  await submitExerciseEntry(jk, DAY, ME, CARD, "Pretend first go");
  await saveExerciseDraft(jk, DAY, ME, CARD, ""); // she selects it all and deletes it
  expect((await readExerciseEntry(jk, DAY, CARD, ME)).entry).toMatchObject({ text: "", submitted: true, saved: false });
  // Another device's box isn't steered by this device's empty draft.
  expect((await readExerciseEntry(jk, DAY, CARD, "device-other-01")).entry).toMatchObject({ text: "Pretend first go" });
  const [e] = (await listExerciseEntries(jk, "2026-11-05")).entries;
  expect(e).toMatchObject({ text: "Pretend first go", submitted: true });
});

it("an emptied draft that is older than a newer answer doesn't hide it", async () => {
  await saveExerciseDraft(jk, DAY, ME, CARD, "");
  await submitExerciseEntry(jk, DAY, ME, CARD, "Pretend later answer");
  expect((await readExerciseEntry(jk, DAY, CARD, ME)).entry).toMatchObject({ text: "Pretend later answer", saved: true });
});

it("another device's same-day answer under an ordinary submit is 'Also submitted', never 'Earlier version' (m1)", async () => {
  const key = await exerciseCardIdKey(jk, CARD.id);
  const id = journalId("exercise-entry", DAY, `${key}:${ME}`);
  await db.journal.put({
    id, kind: "exercise-entry", date: DAY, fp: jk.fp,
    ...(await sealJson(jk.key, { v: 2, ...CARD, text: "Pretend Mac answer", submittedAt: 5, at: 5 }, journalAad(id))),
  });
  await submitExerciseEntry(jk, DAY, PHONE, CARD, "Pretend phone answer");
  const [e] = (await listExerciseEntries(jk, "2026-11-05")).entries;
  expect(e!.text).toBe("Pretend phone answer");
  expect(e!.others).toEqual([expect.objectContaining({ text: "Pretend Mac answer", submitted: true })]);
  expect(e!.others[0]!.earlier).toBeUndefined();
});

it("an edit's earlier version is only this device's own: another device's answer stays 'Also submitted' (m1)", async () => {
  await submitExerciseEntry(jk, DAY, PHONE, CARD, "Pretend phone answer");
  await submitExerciseEntry(jk, DAY, ME, CARD, "Pretend Mac answer");
  await saveExerciseEdit(jk, DAY, ME, CARD, "Pretend Mac answer, changed");
  const [e] = (await listExerciseEntries(jk, "2026-11-05")).entries;
  expect(e!.text).toBe("Pretend Mac answer, changed");
  const label = (t: string) => e!.others.find((o) => o.text === t)!.earlier;
  expect(label("Pretend Mac answer")).toBe(true);
  expect(label("Pretend phone answer")).toBeUndefined();
});
