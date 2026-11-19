import { db } from "../data/db";
import { saveDayLog, saveWeekReview } from "../data/repo";
import { EMPTY_WEEK_REVIEW } from "../journal/routine";
import { sendToTogether } from "./sender";
import { clock, DEVICE, emptyDb, guardedFetch, journalDay, liveNote, signedIn } from "./testKit";

// "What I did" (Esme, 19 Nov 2026): the weekly review SHOWS "Completed this week" (the to-dos done
// that week, with her notes), but that list is display only. Nothing of it (to-do titles, notes,
// file names or folders) may ever go to Together, with the review or any other way. Every
// request is recorded. Made-up words only.

beforeEach(emptyDb);

const SUN = "2026-11-15";
const FORBIDDEN = [
  "Pretend Marrowind chapter", "Pretend wrote the Marrowind ending", "marrowind-final.docx", "~/Desktop/Writing",
  "Pretend Tessaly session", "Pretend inked the Tessaly cover", "Pretend Tessaly zine",
];

it("a done weekly review goes; the week's to-dos and their notes never do", async () => {
  const c = clock(`${SUN}T19:00:00`);
  const fake = await signedIn(c);
  const { jk } = await journalDay(SUN, { exercise: true });
  await db.items.bulkPut([
    {
      id: "t1", kind: "task", title: "Pretend Marrowind chapter", links: [], areaId: "writing", priority: 2, status: "done",
      completedAt: "2026-11-12", createdAt: "2026-11-01", touchedAt: "2026-11-12",
      did: [{ id: "e1", on: "2026-11-12", note: "Pretend wrote the Marrowind ending", files: [{ name: "marrowind-final.docx", folder: "~/Desktop/Writing" }] }],
    },
    {
      id: "p1", kind: "task", title: "Pretend Tessaly zine", links: [], areaId: "art", priority: 2, status: "open",
      createdAt: "2026-11-01", touchedAt: "2026-11-14", sessions: [{ id: "s1", title: "Pretend Tessaly session", doneOn: "2026-11-14" }, { id: "s2" }],
      did: [{ id: "e2", on: "2026-11-14", session: "s1", note: "Pretend inked the Tessaly cover" }],
    },
  ]);
  await saveWeekReview(jk, DEVICE, { ...EMPTY_WEEK_REVIEW, well: "Pretend review words" }, { date: SUN, seen: [], submittedAt: null }, true);
  await saveDayLog(jk, DEVICE, { schedule: "yes", scheduleNote: "", todos: "yes", todosNote: "" }, { date: SUN, seen: [], submittedAt: null }, true);
  const rec = guardedFetch(fake.fetch, () => FORBIDDEN, c.now);
  expect(await sendToTogether({ fetch: rec.fetch, now: c.now })).toMatchObject({ kind: "ok" });
  c.set("2026-11-16T09:00:00");
  expect(await sendToTogether({ fetch: rec.fetch, now: c.now })).toMatchObject({ kind: "ok" });
  expect(rec.violations).toEqual([]);
  // It did send the review itself.
  expect(liveNote(fake, SUN)).toContain("Pretend review words");
  expect(fake.todos.size + fake.events.size).toBe(0);
});
