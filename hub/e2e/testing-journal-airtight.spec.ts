import { expect, test, type Locator, type Page } from "@playwright/test";
import { FAKE_CARD_TEXT_V2 } from "../src/test/exerciseCards";

/* Testing session, 2026-11-05: the Journal airtight guard suite. Esme's rule: "whatever i
   complete in journal section is saved and is easy to revisit and see". For each part she
   completes (an exercise card, a card with parts, morning pages, the daily check-in, a note of
   her own and an answer to a note prompt) this does it the way a person does: click in the box,
   type key by key, stop to think, click somewhere else, then press the button. Then, word for
   word: it shows as done in its tab at once, after a reload, where she rereads it (Read back,
   Hard moment for notes), and after going to Home and back. And it is never in IndexedDB (or
   local storage) in clear: "saved" means saved sealed.

   WebKit (the Mac app's engine) by default; E2E_ENGINE=chromium for Chrome. A fresh profile per
   test. FICTIONAL words only; the sync address is a made-up one that never answers. */

const PASS = "fake-journal-e2e-passphrase";
const ENGINE = process.env.E2E_ENGINE === "chromium" ? "chromium" : "webkit";
test.use(ENGINE === "webkit" ? { browserName: "webkit", channel: "" } : {});
// Playwright's WebKit sometimes throws "DataCloneError" storing the CryptoKey during the set-up's
// unlock (a known quirk of the test browser, not the app): such a test is run again.
test.describe.configure({ retries: 2 });

const DAY_MS = 86_400_000;
const THINK_MS = 1500;

// ---------------------------------------------------------------- set-up

async function unlocked(page: Page, path: string) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  await page.evaluate(async (pass) => {
    const at = (p: string): Promise<any> => import(/* @vite-ignore */ p); // the app's own module (dev server)
    const engine = await at("/src/sync/engine.ts");
    const token = await at("/src/sync/token.ts");
    const keys = await at("/src/journal/keyStore.ts");
    const { db } = await at("/src/data/db.ts");
    await engine.saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: await token.deriveToken(pass) });
    // The journal was set up on another device: its check row is here (an acceptance
    // recorded before the key is typed no longer confirms it, bug #4; journal-rekey).
    const jkey = await at("/src/test/journalKey.ts");
    await db.journal.put(await jkey.verifierRow(await jkey.keyFor(pass)));
    await keys.unlockJournal(db, pass);
  }, PASS);
  await page.goto(path);
}

/** Today in the app (its day runs 3am to 3am), and a date as the app writes it ("Thursday 5 November"). */
async function appDay(page: Page, offset = 0): Promise<{ iso: string; long: string }> {
  return page.evaluate(async (off) => {
    const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
    const dates = await at("/src/domain/dates.ts");
    const iso: string = dates.addDays(dates.todayISO(), off);
    const [y, m, d] = iso.split("-").map(Number);
    const long = new Date(y!, m! - 1, d!).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    return { iso, long };
  }, offset);
}

/** A local time on a date some days from today's calendar date (for page.clock). */
function localAt(daysFromNow: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d;
}

// ---------------------------------------------------------------- a person

/** Click in the box, type key by key, stop to think; then (if `away`) click somewhere else. */
async function typeLikeAPerson(page: Page, box: Locator, words: string, away?: Locator) {
  await box.click();
  await box.press("End");
  await box.pressSequentially(words, { delay: 25 });
  await page.waitForTimeout(THINK_MS); // she stops to think; the box autosaves meanwhile
  if (away) await away.click();
}

const tabLink = (page: Page, name: string) => page.getByRole("navigation", { name: "Journal parts" }).getByRole("link", { name: new RegExp(name) });

/** The Journal tab says it is done today (its tick and its hidden words). */
async function tabDone(page: Page, name: string) {
  const link = tabLink(page, name);
  await expect(link.locator(".tick-auto.is-done")).toBeVisible();
  await expect(link).toContainText("(done today)");
}

/**
 * Away to Home and back the way she would: the sidebar's Home (the phone's Back), Home's Journal
 * row says it's done (when it has one), and its row (or the sidebar's Journal, then the tab) back.
 */
async function homeAndBack(page: Page, part: "Mental health exercise" | "Morning pages" | "Daily check-in" | "Notes to myself") {
  const phone = (page.viewportSize()?.width ?? 1280) < 700;
  if (phone) {
    // The phone has only Back (it walks back through the tabs she opened): tap it until Home.
    for (let i = 0; i < 6 && new URL(page.url()).pathname !== "/"; i++) {
      await page.getByRole("button", { name: "Back" }).click();
      await page.waitForTimeout(300);
    }
  } else await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const rows = page.getByRole("list", { name: "Journal" });
  if (part === "Notes to myself") {
    if (phone) await page.goto("/journal"); // the phone's Home has no Journal link of its own here
    else await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Journal", exact: true }).click();
    await tabLink(page, "Notes to myself").click();
    await expect(page).toHaveURL(/\/journal\/notes$/);
    return;
  }
  await expect(rows.getByRole("checkbox", { name: `${part} done today` })).toHaveAttribute("aria-checked", "true");
  await rows.getByRole("button", { name: part }).click();
  await expect(page).toHaveURL(/\/journal\//);
}

// ---------------------------------------------------------------- stored sealed

/**
 * Every row of every IndexedDB database on the page (bytes decoded as text), and local and
 * session storage: none of `words` may be in it. Also returns how many journal rows there are,
 * so the check is never made against an empty store.
 */
async function noWordsInClear(page: Page, words: string[]) {
  const { dump, journalRows } = await page.evaluate(async () => {
    const asText = async (v: unknown): Promise<unknown> => {
      if (v instanceof Blob) return await v.text();
      if (v instanceof ArrayBuffer) return new TextDecoder().decode(v);
      if (ArrayBuffer.isView(v)) return new TextDecoder().decode(v as Uint8Array);
      if (Array.isArray(v)) return Promise.all(v.map(asText));
      if (v && typeof v === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) out[k] = await asText(x);
        return out;
      }
      return v;
    };
    const parts: string[] = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })];
    let journalRows = 0;
    for (const info of await indexedDB.databases()) {
      const idb: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open(info.name!);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      for (const store of Array.from(idb.objectStoreNames)) {
        const rows: unknown[] = await new Promise((res, rej) => {
          const r = idb.transaction(store, "readonly").objectStore(store).getAll();
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        if (store === "journal") journalRows += rows.length;
        parts.push(JSON.stringify(await asText(rows)));
      }
      idb.close();
    }
    return { dump: parts.join("\n"), journalRows };
  });
  expect(journalRows).toBeGreaterThan(0);
  for (const w of words) expect(dump, `"${w}" is stored in clear`).not.toContain(w);
}

// ================================================================ Mental health exercise

const EX_TEXT = "Pretend Quillberry answer: one small grey cloud drifting over the made-up hill.";
const KETTLE = {
  text: "Pretend Thrumble whistle, like a toy train far away",
  places: ["Pretend Thrumble chest", "Pretend Thrumble hands", "Pretend Thrumble feet"],
};

const exerciseTab = (page: Page) => page.getByRole("region", { name: "Mental health exercise" });

async function importCards(page: Page) {
  await exerciseTab(page).getByLabel("Exercise card file").setInputFiles({
    name: "pretend-cards.json",
    mimeType: "application/json",
    buffer: Buffer.from(FAKE_CARD_TEXT_V2),
  });
}

/** Day 1 (one answer box), typed like a person, then Submit. */
async function submitDay1(page: Page) {
  const today = exerciseTab(page).getByRole("article", { name: "Today's card" });
  await expect(today.getByText("Pretend weather")).toBeVisible();
  await typeLikeAPerson(page, today.getByLabel("Your response"), EX_TEXT, today.getByRole("heading", { name: "Try this" }));
  await today.getByRole("button", { name: "Submit" }).click();
  await expect(exerciseTab(page).getByText("Day 1 · Pretend weather saved. Here's the next one if you'd like to keep going.")).toBeVisible();
}

/** "Past exercises" on the tab: the response's line opens to her words. */
async function pastExercise(page: Page, line: string): Promise<Locator> {
  const s = exerciseTab(page);
  const fold = s.locator("details.journal-fold", { has: page.getByText("Past exercises", { exact: true }) });
  await fold.locator("> summary").click();
  const item = fold.locator("details", { has: page.locator(`summary:text-is("${line}")`) });
  await item.locator("> summary").click();
  return item;
}

/**
 * Read back (option B, 2026-11-05): four tiles, one per Journal part; tapping one opens that
 * part's own section (its heading, then its entries by month). Returns the part's section.
 */
async function readBack(page: Page, part: string): Promise<Locator> {
  await tabLink(page, "Read back").click();
  await page.locator("button.journal-readback-tile", { hasText: part }).click();
  const section = page.locator("section.journal-readback-part");
  await expect(section.getByRole("heading", { level: 3, name: part })).toBeVisible();
  return section;
}

/** One Read back entry in its part's section, opened (a <details>). */
async function readBackItem(page: Page, part: string, line: string | RegExp): Promise<Locator> {
  const section = await readBack(page, part);
  // Relative to each entry (a `has` locator is searched inside the entry, not from the page).
  const summary = typeof line === "string" ? page.locator(`summary:text-is("${line}")`) : page.locator("summary").filter({ hasText: line });
  const item = section.locator("details", { has: summary });
  await expect(item).toHaveCount(1);
  await item.locator("> summary").click();
  return item;
}

/** A check-in day's line in Read back: its date and how many answers. */
const checkinLine = (long: string) => new RegExp(`^${long.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · \\d+ answers?$`);

/** The kettle card's four parts, word for word, as she answered them. */
async function kettleShown(where: Locator) {
  const parts = where.locator("ol.exercise-part-answers > li");
  await expect(parts).toHaveCount(4);
  await expect(parts.nth(0).locator(".exercise-label")).toHaveText("What does your pretend whistle sound like?");
  await expect(parts.nth(0).locator(".journal-past-answer")).toHaveText(KETTLE.text);
  await expect(parts.nth(1).locator(".exercise-label")).toHaveText("Three pretend places you feel it");
  await expect(parts.nth(1).locator("ol.exercise-list-answer > li")).toHaveText(KETTLE.places);
  await expect(parts.nth(2).locator(".exercise-label")).toHaveText("How loud is it right now?");
  await expect(parts.nth(2).locator(".journal-past-answer")).toHaveText("6 out of 10");
  await expect(parts.nth(3).locator(".exercise-label")).toHaveText("Which pretend kettle is it?");
  await expect(parts.nth(3).locator(".journal-past-answer")).toHaveText("Tin");
  await expect(where.getByText("Not answered")).toHaveCount(0);
}

test.describe("Mental health exercise at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test(`${ENGINE}: a submitted answer is saved and shown: tab, reload, Read back, Home and back`, async ({ page }) => {
    test.setTimeout(120_000);
    await unlocked(page, "/journal/exercise");
    await importCards(page);
    const { long } = await appDay(page);
    await submitDay1(page);

    // (a) Done in its tab at once, and her words under Past exercises.
    await tabDone(page, "Mental health exercise");
    await expect((await pastExercise(page, `${long} · Day 1 · Pretend weather`)).locator(".journal-past-answer")).toHaveText(EX_TEXT);

    // (b) After a reload.
    await page.reload();
    await tabDone(page, "Mental health exercise");
    await expect(exerciseTab(page).getByText("Day 1 · Pretend weather saved.", { exact: false })).toBeVisible();
    await expect((await pastExercise(page, `${long} · Day 1 · Pretend weather`)).locator(".journal-past-answer")).toHaveText(EX_TEXT);

    // (c) In Read back.
    const rb = await readBackItem(page, "Mental health exercise", `${long} · Day 1 · Pretend weather`);
    await expect(rb.locator(".journal-past-answer")).toBeVisible();
    await expect(rb.locator(".journal-past-answer")).toHaveText(EX_TEXT);
    await expect(rb.getByText("Not submitted")).toHaveCount(0);

    // (d) Home and back.
    await homeAndBack(page, "Mental health exercise");
    await tabDone(page, "Mental health exercise");
    await expect((await pastExercise(page, `${long} · Day 1 · Pretend weather`)).locator(".journal-past-answer")).toHaveText(EX_TEXT);

    await noWordsInClear(page, [EX_TEXT, "Quillberry"]);
  });

  test(`${ENGINE}: a card with parts (text, list, rating, choice): every part saved and shown`, async ({ page }) => {
    test.setTimeout(150_000);
    await unlocked(page, "/journal/exercise");
    await importCards(page);
    const { long } = await appDay(page);
    await submitDay1(page);

    const next = exerciseTab(page).getByRole("article", { name: "Next card: Day 2" });
    await expect(next.getByText("The fictional kettle")).toBeVisible();
    const away = next.getByRole("heading", { name: "Learn" });
    await typeLikeAPerson(page, next.getByLabel("What does your pretend whistle sound like?"), KETTLE.text, away);
    for (const [i, w] of KETTLE.places.entries()) {
      await typeLikeAPerson(page, next.getByLabel(`Three pretend places you feel it, ${i + 1}`), w, i === 1 ? away : undefined);
    }
    await expect(next.getByText("3 of 3 filled")).toBeVisible();
    await next.getByRole("group", { name: "How loud is it right now?" }).getByRole("button", { name: "6", exact: true }).click();
    await next.getByRole("group", { name: "Which pretend kettle is it?" }).getByRole("button", { name: "Tin" }).click();
    await page.waitForTimeout(THINK_MS);
    await away.click();
    await next.getByRole("button", { name: "Submit" }).click();

    // (a) At once.
    const s = exerciseTab(page);
    await expect(s.getByText("Day 2 · The fictional kettle saved. Here's the next one if you'd like to keep going.")).toBeVisible();
    await tabDone(page, "Mental health exercise");
    await kettleShown(await pastExercise(page, `${long} · Day 2 · The fictional kettle`));

    // (b) After a reload, and in "See what you wrote" (the chapter map's Your responses).
    await page.reload();
    await tabDone(page, "Mental health exercise");
    await kettleShown(await pastExercise(page, `${long} · Day 2 · The fictional kettle`));
    await s.getByRole("button", { name: "See what you wrote" }).click();
    const map = page.getByRole("dialog", { name: "Your workbooks" });
    await kettleShown(map.getByRole("list", { name: "Your responses" }));
    await map.locator(".choose-top").getByRole("button", { name: "Done" }).click();

    // (c) Read back: both cards, each word for word.
    await kettleShown(await readBackItem(page, "Mental health exercise", `${long} · Day 2 · The fictional kettle`));
    const day1 = await readBackItem(page, "Mental health exercise", `${long} · Day 1 · Pretend weather`);
    await expect(day1.locator(".journal-past-answer")).toHaveText(EX_TEXT);

    // (d) Home and back.
    await homeAndBack(page, "Mental health exercise");
    await kettleShown(await pastExercise(page, `${long} · Day 2 · The fictional kettle`));

    await noWordsInClear(page, [EX_TEXT, KETTLE.text, ...KETTLE.places, "Thrumble", "Quillberry"]);
  });
});

// ================================================================ Morning pages

const MORNING = "Pretend Marrowind morning words. The made-up kettle hums, the pretend cat naps, and I keep the pen moving.";

test.describe("Morning pages at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test(`${ENGINE}: "I'm done" is saved: done at once, reload, Read back (locked, then open after 4 weeks), Home and back`, async ({ page }) => {
    test.setTimeout(150_000);
    // The clock runs naturally from now; later it is put forward 29 days.
    const start = new Date();
    await page.clock.install({ time: start });
    await unlocked(page, "/journal/morning");
    const { iso, long } = await appDay(page);
    const opens = await appDay(page, 28);

    const box = page.getByLabel("Today's morning page");
    await typeLikeAPerson(page, box, MORNING, page.getByText("Three pages, longhand if you can", { exact: false }));
    await expect(page.getByText("18 of 1,000 words")).toBeVisible();
    await page.getByRole("button", { name: "I'm done" }).click();

    // (a) Done at once: the box, the tab's tick, today on the calendar. The page itself stays
    // hidden for 4 weeks (her rule: don't reread), so the words are nowhere on the page.
    const done = async () => {
      await expect(page.getByText("Done for today")).toBeVisible();
      await tabDone(page, "Morning pages");
      await expect(page.getByRole("group", { name: "Morning pages calendar" }).locator(`[data-date="${iso}"]`)).toHaveClass(/\bon\b/);
      await expect(page.getByLabel("Today's morning page")).toHaveValue("");
      await expect(page.locator("body")).not.toContainText("Marrowind");
    };
    await done();

    // (b) After a reload.
    await page.reload();
    await done();

    // (c) Read back: listed, locked until its day.
    const list = await readBack(page, "Morning pages");
    const locked = list.locator(".journal-readback-locked", { hasText: long });
    await expect(locked).toHaveCount(1);
    await expect(locked).toContainText(`Opens on ${opens.long}`);
    await expect(page.locator("body")).not.toContainText("Marrowind");

    // (d) Home and back.
    await homeAndBack(page, "Morning pages");
    await done();

    await noWordsInClear(page, [MORNING, "Marrowind"]);

    // 29 days on: Read back opens it, word for word.
    await page.clock.setSystemTime(new Date(start.getTime() + 29 * DAY_MS));
    await page.reload();
    expect((await appDay(page)).iso > opens.iso).toBe(true);
    const page1 = await readBackItem(page, "Morning pages", long);
    await expect(page1.locator(".journal-readback-text")).toBeVisible();
    await expect(page1.locator(".journal-readback-text")).toHaveText(MORNING);
    await noWordsInClear(page, [MORNING, "Marrowind"]); // opening it never stores it in clear
  });
});

// ================================================================ Daily check-in

const CHECKIN = [
  "Pretend Glimmerfen first answer: the made-up birds were loud at the window",
  "Pretend Glimmerfen second answer: I asked a pretend friend for help",
  "Pretend Glimmerfen third answer: a warm pretend bath, then Finish",
];
const CHANGED = ", and then a pretend Snorvel walk";

const checkinTab = (page: Page) => page.getByRole("region", { name: "Daily check-in" });

/** Every question answered like a person (Next, then Finish); returns the questions' words. */
async function answerCheckin(page: Page): Promise<string[]> {
  const s = checkinTab(page);
  const questions: string[] = [];
  for (let i = 0; i < 3; i++) {
    await expect(s.getByRole("img", { name: `Question ${i + 1} of 3` })).toBeVisible();
    const q = (await s.locator(".journal-question .journal-q").innerText()).trim();
    questions.push(q);
    // Every question she stops to think; on the first two she clicks away too.
    await typeLikeAPerson(page, s.getByLabel("Your answer"), CHECKIN[i]!, i < 2 ? s.locator(".journal-question .journal-q") : undefined);
    await s.getByRole("button", { name: i === 2 ? "Finish" : "Next →" }).click();
  }
  expect(new Set(questions).size).toBe(3);
  return questions;
}

/** The finished check-in: "Checked in for today", each question with her answer, and Edit. */
async function checkedIn(page: Page, questions: string[], answers: string[]) {
  const s = checkinTab(page);
  await expect(s.getByText("Checked in for today")).toBeVisible();
  const items = s.locator("ol.journal-answers > li");
  await expect(items).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(items.nth(i).locator(".journal-q")).toHaveText(questions[i]!);
    await expect(items.nth(i).getByLabel("Your answer")).toHaveText(answers[i]!);
  }
  await expect(s.getByRole("textbox")).toHaveCount(0);
  await expect(s.getByRole("button", { name: "Edit" })).toBeVisible();
}

/** A day's check-in in a list (Read back's item or a Past check-ins day): each question and answer. */
async function checkinListed(where: Locator, questions: string[], answers: string[]) {
  const items = where.locator("ol.journal-answers > li");
  await expect(items).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(items.nth(i).locator(".journal-q")).toHaveText(questions[i]!);
    await expect(items.nth(i).locator(".journal-past-answer")).toBeVisible();
    await expect(items.nth(i).locator(".journal-past-answer")).toHaveText(answers[i]!);
  }
}

for (const width of [1280, 390]) {
  test.describe(`Daily check-in at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

    test(`${ENGINE}: all questions, Finish: answers saved and shown; Edit, change, Save, reload shows the change`, async ({ page }) => {
      test.setTimeout(150_000);
      await unlocked(page, "/journal/check-in");
      const { long } = await appDay(page);
      const questions = await answerCheckin(page);

      // (a) + (e) At once: Checked in for today, every question with her answer, Edit.
      await checkedIn(page, questions, CHECKIN);
      await tabDone(page, "Daily check-in");

      // (b) After a reload.
      await page.reload();
      await checkedIn(page, questions, CHECKIN);
      await tabDone(page, "Daily check-in");

      // (c) Read back.
      await checkinListed(await readBackItem(page, "Daily check-in", checkinLine(long)), questions, CHECKIN);

      // (d) Home and back.
      await homeAndBack(page, "Daily check-in");
      await checkedIn(page, questions, CHECKIN);

      // (e) Edit → change → Save → shown → reload → shown; Read back has the change too.
      const s = checkinTab(page);
      await s.getByRole("button", { name: "Edit" }).click();
      const boxes = s.getByRole("textbox", { name: "Your answer" });
      await expect(boxes).toHaveCount(3);
      for (let i = 0; i < 3; i++) await expect(boxes.nth(i)).toHaveValue(CHECKIN[i]!);
      await typeLikeAPerson(page, boxes.nth(1), CHANGED, s.locator(".journal-q").first());
      await s.getByRole("button", { name: "Save" }).click();
      const edited = [CHECKIN[0]!, CHECKIN[1]! + CHANGED, CHECKIN[2]!];
      await checkedIn(page, questions, edited);
      await page.waitForTimeout(1000); // she looks at it for a moment
      await page.reload();
      await checkedIn(page, questions, edited);
      await checkinListed(await readBackItem(page, "Daily check-in", checkinLine(long)), questions, edited);
      await homeAndBack(page, "Daily check-in");
      await checkedIn(page, questions, edited);

      await noWordsInClear(page, [...CHECKIN, CHANGED.slice(2), "Glimmerfen", "Snorvel"]);
    });
  });
}

/** Yesterday's check-in in Past check-ins: the fold, then its day. */
async function pastCheckin(page: Page, long: string): Promise<Locator> {
  const s = checkinTab(page);
  const fold = s.locator("details.journal-fold", { has: page.getByText("Past check-ins", { exact: true }) });
  await fold.locator("> summary").click();
  const day = fold.locator("ul.journal-past > li > details", { has: page.locator(`summary:text-is("${long}")`) });
  await expect(day).toHaveCount(1);
  await day.locator("> summary").click();
  return day;
}

test.describe("Daily check-in across 3am at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  for (const [when, at] of [
    ["in the evening (22:00)", localAt(0, 22)],
    ["after midnight, before 3am (01:30, still that day)", localAt(1, 1, 30)],
  ] as const) {
    test(`${ENGINE}: finished ${when}; past 03:00 the next day her answers are in Past check-ins and Read back`, async ({ page }) => {
      test.setTimeout(150_000);
      await page.clock.install({ time: at });
      await unlocked(page, "/journal/check-in");
      const day = await appDay(page);
      expect(day.iso).toBe(localAt(0, 12).toLocaleDateString("en-CA")); // the evening's own day
      const questions = await answerCheckin(page);
      await checkedIn(page, questions, CHECKIN);

      // Past 03:00 the next day, the app left open: she comes back to it (a focus).
      await page.clock.setSystemTime(localAt(1, 3, 5));
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      const s = checkinTab(page);
      await expect(s.getByText("Checked in for today")).toHaveCount(0); // a new day's check-in
      await expect(s.getByRole("img", { name: /^Question 1 of \d+$/ })).toBeVisible();
      await checkinListed(await pastCheckin(page, day.long), questions, CHECKIN);

      // And after a reload, and in Read back.
      await page.reload();
      expect((await appDay(page)).iso).toBe(localAt(1, 12).toLocaleDateString("en-CA"));
      await expect(checkinTab(page).getByRole("img", { name: /^Question 1 of \d+$/ })).toBeVisible();
      await checkinListed(await pastCheckin(page, day.long), questions, CHECKIN);
      await checkinListed(await readBackItem(page, "Daily check-in", checkinLine(day.long)), questions, CHECKIN);

      await noWordsInClear(page, [...CHECKIN, "Glimmerfen"]);
    });
  }
});

// ================================================================ Notes to myself

const OWN = {
  thought: "Pretend Wobbleton thought: nobody likes my made-up songs",
  steady: "Pretend Wobbleton steady: three pretend friends hum along every time",
};
const PROMPT = {
  prompt: "I'm too much",
  steady: "Pretend Fennick steady: the made-up people stayed for tea",
  memory: "Pretend Fennick memory: the pretend picnic in the rain",
  skill: "Pretend Fennick skill: a slow made-up breath",
};

const notesTab = (page: Page) => page.getByRole("region", { name: "Notes to myself" });

/** A saved note's strip in a group (or the Hard moment list), word for word. */
async function noteShown(where: Locator, note: { thought: string; steady: string; memory?: string; skill?: string }) {
  const strip = where.locator("li.notes-card", { has: where.page().locator(`.strip-title:text-is("${note.thought}")`) });
  await expect(strip).toHaveCount(1);
  await expect(strip.locator(".notes-steady")).toBeVisible();
  await expect(strip.locator(".notes-steady")).toHaveText(note.steady);
  if (note.memory) await expect(strip.getByText(note.memory, { exact: true })).toBeVisible();
  if (note.skill) await expect(strip.getByText(note.skill, { exact: true })).toBeVisible();
}

/** A note opened in Read back: every part of it she wrote is on screen, word for word. */
async function noteInReadBack(entry: Locator, note: { thought: string; steady: string; memory?: string; skill?: string }) {
  for (const words of [note.thought, note.steady, note.memory, note.skill]) {
    if (words) await expect(entry.getByText(words, { exact: false }).first()).toBeVisible();
  }
}

/** Her notes in the Hard moment pop-up, then closed. */
async function inHardMoment(page: Page, note: { thought: string; steady: string; memory?: string; skill?: string }) {
  await page.getByRole("button", { name: "Hard moment" }).click();
  const sheet = page.getByRole("dialog", { name: "Notes to myself" });
  await noteShown(sheet, note);
  await sheet.locator(".choose-top").getByRole("button", { name: "Done" }).click();
  await expect(sheet).toHaveCount(0);
}

test.describe("Notes to myself at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test(`${ENGINE}: a note of her own (+ My own thought, Save): shown at once, reload, Hard moment, Home and back`, async ({ page }) => {
    test.setTimeout(120_000);
    await unlocked(page, "/journal/notes");
    const s = notesTab(page);
    await s.getByRole("button", { name: "+ My own thought" }).click();
    const form = s.getByRole("form", { name: "Your note" });
    const intro = s.getByText("Write these when you feel steady", { exact: false });
    await typeLikeAPerson(page, form.getByRole("textbox", { name: "When I think…" }), OWN.thought, intro);
    await typeLikeAPerson(page, form.getByRole("textbox", { name: "What I know when I'm steady…" }), OWN.steady, intro);
    await form.getByRole("button", { name: "Save" }).click();

    const mine = () => notesTab(page).getByRole("group", { name: "My own thoughts" });
    // (a) At once.
    await expect(s.getByRole("form")).toHaveCount(0);
    await noteShown(mine(), OWN);
    // (b) After a reload (and no editor coming back open: it was saved, not a draft).
    await page.reload();
    await noteShown(mine(), OWN);
    await expect(notesTab(page).getByRole("form")).toHaveCount(0);
    // (c) Where she rereads her notes: Hard moment, and Notes to myself in Read back.
    await inHardMoment(page, OWN);
    await noteInReadBack(await readBackItem(page, "Notes to myself", new RegExp(` · ${OWN.thought}$`)), OWN);
    // (d) Home and back.
    await homeAndBack(page, "Notes to myself");
    await noteShown(mine(), OWN);

    await noWordsInClear(page, [OWN.thought, OWN.steady, "Wobbleton"]);
  });

  test(`${ENGINE}: an answer to a prompt ("I'm too much", with memory and skill): shown at once, reload, Hard moment, Home and back`, async ({ page }) => {
    test.setTimeout(120_000);
    await unlocked(page, "/journal/notes");
    const s = notesTab(page);
    await s.getByRole("button", { name: `+ Write your answer: ${PROMPT.prompt}` }).click();
    const form = s.getByRole("form", { name: "Your note" });
    await expect(form.getByRole("textbox", { name: "When I think…" })).toHaveValue(PROMPT.prompt);
    const away = s.getByRole("heading", { name: "Self-worth" });
    await typeLikeAPerson(page, form.getByRole("textbox", { name: "What I know when I'm steady…" }), PROMPT.steady, away);
    await typeLikeAPerson(page, form.getByRole("textbox", { name: "A memory or evidence (optional)" }), PROMPT.memory);
    await typeLikeAPerson(page, form.getByRole("textbox", { name: "A skill to try (optional)" }), PROMPT.skill, away);
    await form.getByRole("button", { name: "Save" }).click();

    const note = { thought: PROMPT.prompt, steady: PROMPT.steady, memory: PROMPT.memory, skill: PROMPT.skill };
    const group = () => notesTab(page).getByRole("group", { name: "Self-worth" });
    await expect(s.getByRole("form")).toHaveCount(0);
    await noteShown(group(), note);
    await page.reload();
    await noteShown(group(), note);
    await expect(notesTab(page).getByRole("form")).toHaveCount(0);
    await inHardMoment(page, note);
    await noteInReadBack(await readBackItem(page, "Notes to myself", new RegExp(` · ${note.thought.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)), note);
    await homeAndBack(page, "Notes to myself");
    await noteShown(group(), note);

    await noWordsInClear(page, [PROMPT.steady, PROMPT.memory, PROMPT.skill, "Fennick"]);
  });
});

// ================================================================ What I learned today (Together link)

/* The optional "What I learned about BPD or mental health today" box under the exercise (kind
   `learned:<date>:<device>`, sealed). Every way she leaves it must keep her words: a pause, a
   click away, the app hidden, Home and back, the window closed and opened again (each checked
   after a reload too). Each step adds its own made-up word, so a failure says which way lost it. */

const LEARNED_LABEL = "What I learned about BPD or mental health today (optional)";
const LEARNED = {
  pause: "Pretend Pellucid lesson: a made-up wave rises, peaks and passes.",
  away: " Pretend Brindlewick: naming it makes it smaller.",
  hidden: " Pretend Corvantle: the phone locked mid-thought.",
  home: " Pretend Sallowmere: went Home and came back.",
  closed: " Pretend Tinderquay: closed the window and opened it again.",
};
const LEARNED_WORDS = ["Pellucid", "Brindlewick", "Corvantle", "Sallowmere", "Tinderquay"];

const learnedBox = (page: Page) => exerciseTab(page).getByLabel(LEARNED_LABEL);
/** Somewhere else on the exercise tab to click (the box's own heading text). */
const learnedAway = (page: Page) => exerciseTab(page).getByText(LEARNED_LABEL);

/**
 * Click in the box, put the cursor after the last word (where she clicks to carry on: End only
 * goes to the end of a wrapped line), type key by key, stop to think; then (if `away`) click away.
 */
async function addLikeAPerson(page: Page, box: Locator, words: string, away?: Locator) {
  await box.click();
  await box.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  await box.pressSequentially(words, { delay: 25 });
  await page.waitForTimeout(THINK_MS);
  if (away) await away.click();
}

/** The day's learned words as the app reads them back (opened with this device's key). */
async function storedLearned(page: Page, iso: string): Promise<{ text: string; others: string[] }> {
  return page.evaluate(async (d) => {
    const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
    const { db } = await at("/src/data/db.ts");
    const keys = await at("/src/journal/keyStore.ts");
    const repo = await at("/src/data/repo.ts");
    const l = await repo.readLearned(await keys.loadJournalKey(db), d);
    return { text: l.text, others: l.others.map((o: { text: string }) => o.text) };
  }, iso);
}

/** The page goes to the background (app switched away, phone locked): visibilitychange to hidden. */
async function hidePage(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** "What I learned, earlier days": the day's long date, then her words. */
async function learnedEarlier(page: Page, long: string): Promise<Locator> {
  const s = exerciseTab(page).getByRole("region", { name: "What I learned" });
  const fold = s.locator("details", { has: page.getByText("What I learned, earlier days", { exact: true }) });
  await fold.locator("> summary").click();
  const day = fold.locator("li", { has: page.locator(`p:text-is("${long}")`) });
  await expect(day).toHaveCount(1);
  return day;
}

for (const width of [1280, 390]) {
  test.describe(`What I learned today at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

    test(`${ENGINE}: typed like a person: pause, click away, hidden, Home and back, closed and reopened: word for word, sealed`, async ({ page, context }) => {
      test.setTimeout(150_000);
      await unlocked(page, "/journal/exercise");
      const { iso } = await appDay(page);
      let want = "";

      // (1) Typed, then she stops to think (no click away): the pause saves it.
      await expect(learnedBox(page)).toBeVisible();
      await typeLikeAPerson(page, learnedBox(page), LEARNED.pause);
      want += LEARNED.pause;
      expect((await storedLearned(page, iso)).text).toBe(want);
      await page.reload();
      await expect(learnedBox(page)).toHaveValue(want);

      // (2) More, then a click somewhere else at once (before the pause would save it).
      await learnedBox(page).click();
      await learnedBox(page).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
      await learnedBox(page).pressSequentially(LEARNED.away, { delay: 25 });
      await learnedAway(page).click();
      want += LEARNED.away;
      await expect.poll(async () => (await storedLearned(page, iso)).text).toBe(want);
      await page.reload();
      await expect(learnedBox(page)).toHaveValue(want);

      // (3) More, then the app goes to the background at once (phone locked, app switched).
      await learnedBox(page).click();
      await learnedBox(page).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
      await learnedBox(page).pressSequentially(LEARNED.hidden, { delay: 25 });
      await hidePage(page);
      want += LEARNED.hidden;
      await expect.poll(async () => (await storedLearned(page, iso)).text).toBe(want);
      await page.reload();
      await expect(learnedBox(page)).toHaveValue(want);

      // (4) More, then straight to Home (the box goes away) and back.
      await addLikeAPerson(page, learnedBox(page), LEARNED.home);
      want += LEARNED.home;
      if (width < 700) await page.getByRole("button", { name: "Back" }).click();
      else await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home", exact: true }).click();
      await expect(page).toHaveURL(/\/$/);
      if (width < 700) await page.goto("/journal/exercise");
      else await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Journal", exact: true }).click();
      await expect(learnedBox(page)).toHaveValue(want);

      // (5) More, a pause and a click away, then the window is closed and opened again.
      await addLikeAPerson(page, learnedBox(page), LEARNED.closed, learnedAway(page));
      want += LEARNED.closed;
      await page.close({ runBeforeUnload: true });
      const again = await context.newPage();
      await again.goto("/journal/exercise");
      await expect(learnedBox(again)).toHaveValue(want);
      expect(await storedLearned(again, iso)).toEqual({ text: want, others: [] });
      await noWordsInClear(again, [...Object.values(LEARNED).map((w) => w.trim()), ...LEARNED_WORDS]);
    });

    test(`${ENGINE}: typed, then the Mac app is closed straight away (no pause, no click away): still there when opened again`, async ({ page, context }) => {
      test.setTimeout(120_000);
      await unlocked(page, "/journal/exercise");
      const { iso } = await appDay(page);
      await learnedBox(page).click();
      await learnedBox(page).pressSequentially(LEARNED.pause, { delay: 25 });
      // What the Mac app does on Close (its last window) or Quit: it waits for the page's flush
      // (mac/Esmeworld/main.swift, applicationShouldTerminate), then the page goes.
      expect(await page.evaluate(() => (window as unknown as { esmeworldFlush: () => Promise<{ settled: boolean }> }).esmeworldFlush())).toEqual({ settled: true });
      await page.close({ runBeforeUnload: true });
      const again = await context.newPage();
      await again.goto("/journal/exercise");
      await expect(learnedBox(again)).toHaveValue(LEARNED.pause);
      expect((await storedLearned(again, iso)).text).toBe(LEARNED.pause);
      await noWordsInClear(again, [LEARNED.pause, "Pellucid"]);
    });
  });
}

// ================================================================ Highlights (2026-11-06)

const HL_WORDS = "clouds over a made-up hill";
const HL_NOTE = "Pretend Glimmerfold note: remember this one on a grey pretend day.";

/** Selects words in an element's text the way a person does: press, drag across them, let go. */
async function dragSelect(page: Page, within: Locator, words: string) {
  await within.scrollIntoViewIfNeeded();
  const box = await within.evaluate((el, w) => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const i = (n as Text).data.indexOf(w);
      if (i < 0) continue;
      const at = (k: number) => {
        const r = document.createRange();
        r.setStart(n!, k);
        r.setEnd(n!, k + 1);
        return r.getBoundingClientRect();
      };
      const a = at(i);
      const b = at(i + w.length - 1);
      return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2 };
    }
    return null;
  }, words);
  if (!box) throw new Error(`"${words}" isn't on the page`);
  await page.mouse.move(box.x1, box.y1);
  await page.mouse.down();
  await page.mouse.move(box.x2, box.y2, { steps: 12 });
  await page.mouse.up();
}

for (const width of [1280, 390]) {
  test.describe(`Highlights at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

    test(`${ENGINE}: highlight words in a card, add a note: marked after a reload, in Read back word for word, opens the card; nothing in clear`, async ({ page }) => {
      test.setTimeout(150_000);
      await unlocked(page, "/journal/exercise");
      await importCards(page);
      const today = exerciseTab(page).getByRole("article", { name: "Today's card" });
      await expect(today.getByText("Pretend weather")).toBeVisible();
      const learn = today.locator('[data-hl-field="learn"]');

      // Select, Highlight.
      await dragSelect(page, learn, HL_WORDS);
      await page.getByRole("button", { name: "Highlight", exact: true }).click();
      await expect(learn.locator("mark.hl-mark")).toHaveText(HL_WORDS);
      await page.waitForTimeout(THINK_MS); // she reads on

      // After a reload: still marked.
      await page.reload();
      const mark = exerciseTab(page).getByRole("article", { name: "Today's card" }).locator('[data-hl-field="learn"] mark.hl-mark');
      await expect(mark).toHaveText(HL_WORDS);

      // Tap it, write a note like a person, close.
      await mark.click();
      const sheet = page.getByRole("dialog", { name: "Highlight" });
      await typeLikeAPerson(page, sheet.getByLabel("Note (optional)"), HL_NOTE, sheet.locator(".hl-quote"));
      await sheet.locator(".choose-top").getByRole("button", { name: "Done" }).click();
      await expect(sheet).toHaveCount(0);
      await page.waitForTimeout(THINK_MS);
      await page.reload();

      // Read back: its words and note, word for word, under its book and chapter.
      const part = await readBack(page, "Highlights");
      const entry = part.locator("button.hl-entry");
      await expect(entry).toHaveCount(1);
      await expect(entry.locator(".hl-quote")).toHaveText(HL_WORDS);
      await expect(entry.locator(".hl-note")).toHaveText(HL_NOTE);
      await expect(entry).toContainText("Day 1 · Pretend weather");
      await expect(part.getByText("Couldn't find this in the card any more")).toHaveCount(0);

      // Tapping it opens the card at the words.
      await entry.click();
      await expect(page).toHaveURL(/\/journal\/exercise$/);
      const map = page.getByRole("dialog", { name: "Your workbooks" });
      await expect(map.locator("mark.hl-mark")).toHaveText(HL_WORDS);
      await expect(map.locator("mark.hl-mark")).toBeInViewport();

      await noWordsInClear(page, [HL_NOTE, "Glimmerfold", HL_WORDS]);
    });

    test(`${ENGINE}: words in Read more: marked after a reload, in Read back word for word, opens the card with Read more open at them`, async ({ page }) => {
      test.setTimeout(120_000);
      const words = "clouds pass, hills stay";
      await unlocked(page, "/journal/exercise");
      await importCards(page);
      const today = exerciseTab(page).getByRole("article", { name: "Today's card" });
      await today.getByText("Read more").click();
      const para = today.locator('[data-hl-field="more"]', { hasText: words });
      await dragSelect(page, para, words);
      await page.getByRole("button", { name: "Highlight", exact: true }).click();
      await expect(para.locator("mark.hl-mark")).toHaveText(words);
      await page.waitForTimeout(THINK_MS);
      await page.reload();
      const again = exerciseTab(page).getByRole("article", { name: "Today's card" });
      await again.getByText("Read more").click();
      await expect(again.locator('[data-hl-field="more"] mark.hl-mark')).toHaveText(words);

      const part = await readBack(page, "Highlights");
      const entry = part.locator("button.hl-entry");
      await expect(entry.locator(".hl-quote")).toHaveText(words);
      await entry.click();
      const map = page.getByRole("dialog", { name: "Your workbooks" });
      await expect(map.locator("details.exercise-more")).toHaveAttribute("open", "");
      await expect(map.locator("mark.hl-mark")).toHaveText(words);
      await expect(map.locator("mark.hl-mark")).toBeInViewport();
      await noWordsInClear(page, [words]);
    });
  });
}

test.describe("What I learned today across 3am at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test(`${ENGINE}: typed at 01:30 (still that day); past 03:00 it is under that day in earlier days, and the new day's box is empty`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.clock.install({ time: localAt(1, 1, 30) });
    await unlocked(page, "/journal/exercise");
    const day = await appDay(page);
    expect(day.iso).toBe(localAt(0, 12).toLocaleDateString("en-CA")); // the evening's own day
    await typeLikeAPerson(page, learnedBox(page), LEARNED.pause, learnedAway(page));

    await page.clock.setSystemTime(localAt(1, 3, 5));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(learnedBox(page)).toHaveValue("");
    await expect((await learnedEarlier(page, day.long)).locator(".journal-past-answer")).toHaveText(LEARNED.pause);

    await page.reload();
    const next = await appDay(page);
    expect(next.iso).toBe(localAt(1, 12).toLocaleDateString("en-CA"));
    await expect(learnedBox(page)).toHaveValue("");
    await expect((await learnedEarlier(page, day.long)).locator(".journal-past-answer")).toHaveText(LEARNED.pause);
    expect((await storedLearned(page, day.iso)).text).toBe(LEARNED.pause);
    expect((await storedLearned(page, next.iso)).text).toBe("");
    await noWordsInClear(page, [LEARNED.pause, "Pellucid"]);
  });

  test(`${ENGINE}: still typing at 02:59 when 3am passes (no pause): her words stay on the day she typed them`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.clock.install({ time: localAt(1, 2, 59) });
    await unlocked(page, "/journal/exercise");
    const day = await appDay(page);
    expect(day.iso).toBe(localAt(0, 12).toLocaleDateString("en-CA"));
    await learnedBox(page).click();
    await learnedBox(page).pressSequentially(LEARNED.pause, { delay: 25 });
    // The day changes under her (the app's minute check, or she clicks back into the window).
    await page.clock.setSystemTime(localAt(1, 3, 0));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(learnedBox(page)).toHaveValue("");
    await expect.poll(async () => (await storedLearned(page, day.iso)).text).toBe(LEARNED.pause);
    await page.reload();
    await expect((await learnedEarlier(page, day.long)).locator(".journal-past-answer")).toHaveText(LEARNED.pause);
    expect((await storedLearned(page, (await appDay(page)).iso)).text).toBe("");
  });
});

/* Two devices wrote the box the same day (each its own row). The Mac's words are the older ones,
   so the phone's newer words fill the Mac's box and the Mac's own show under "Also written on
   another device". She adds a line in the box on the Mac. Nothing she wrote on either device may
   go. */
test.describe("What I learned today on two devices at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test(`${ENGINE}: the phone's newer words arrive; she adds to the box on the Mac: the Mac's own earlier words are still kept`, async ({ page }) => {
    test.setTimeout(120_000);
    const MAC_WORDS = "Pretend Quorrel Mac lesson: breathe out longer than in.";
    const PHONE_WORDS = "Pretend Vantry phone lesson: a feeling is a visitor.";
    const ADDED = " Pretend Ellowby added on the Mac.";
    await unlocked(page, "/journal/exercise");
    const { iso } = await appDay(page);
    await typeLikeAPerson(page, learnedBox(page), MAC_WORDS, learnedAway(page));
    await expect.poll(async () => (await storedLearned(page, iso)).text).toBe(MAC_WORDS);

    // The phone's row (written later that day) arrives by sync, sealed as the phone seals it.
    await page.evaluate(async ({ d, text }) => {
      const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
      const { db } = await at("/src/data/db.ts");
      const keys = await at("/src/journal/keyStore.ts");
      const c = await at("/src/journal/crypto.ts");
      const jk = await keys.loadJournalKey(db);
      const id = `learned:${d}:device-pretend-phone-1`;
      await db.journal.put({ id, kind: "learned", date: d, fp: jk.fp, ...(await c.sealJson(jk.key, { v: 1, text, at: Date.now() }, c.journalAad(id))) });
    }, { d: iso, text: PHONE_WORDS });
    await expect(learnedBox(page)).toHaveValue(PHONE_WORDS);
    await expect(exerciseTab(page).getByText("Also written on another device")).toBeVisible();
    await expect(exerciseTab(page).getByText(MAC_WORDS, { exact: true })).toBeVisible();

    // She adds a line in the box, on the Mac.
    await addLikeAPerson(page, learnedBox(page), ADDED, learnedAway(page));
    await page.reload();
    await expect(learnedBox(page)).toHaveValue(PHONE_WORDS + ADDED);
    const s = await storedLearned(page, iso);
    expect([s.text, ...s.others].join("\n"), "the Mac's own earlier words are gone").toContain(MAC_WORDS);
    await expect(exerciseTab(page).getByText(MAC_WORDS, { exact: false })).toBeVisible();
  });
});

// ================================================================ Keep today's answers private (Together link)

const privateTick = (s: Locator) => s.getByRole("checkbox", { name: "Keep today's answers private" });

test.describe("Keep today's answers private at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test(`${ENGINE}: the exercise and check-in ticks each stay as she left them across reloads, and never touch each other`, async ({ page }) => {
    test.setTimeout(120_000);
    await unlocked(page, "/journal/exercise");
    const { iso } = await appDay(page);
    const read = () =>
      page.evaluate(async (d) => {
        const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
        const { db } = await at("/src/data/db.ts");
        const keys = await at("/src/journal/keyStore.ts");
        const repo = await at("/src/data/repo.ts");
        return repo.readSharePrivate(await keys.loadJournalKey(db), d);
      }, iso);

    await expect(privateTick(exerciseTab(page))).toBeEnabled();
    await privateTick(exerciseTab(page)).click();
    await expect(privateTick(exerciseTab(page))).toBeChecked();
    await page.reload();
    await expect(privateTick(exerciseTab(page))).toBeChecked();

    await tabLink(page, "Daily check-in").click();
    await expect(privateTick(checkinTab(page))).toBeEnabled();
    await expect(privateTick(checkinTab(page))).not.toBeChecked();
    await privateTick(checkinTab(page)).click();
    await expect(privateTick(checkinTab(page))).toBeChecked();
    await page.reload();
    await expect(privateTick(checkinTab(page))).toBeChecked();
    expect(await read()).toEqual({ exercise: true, checkin: true });

    // Unticking the exercise leaves the check-in ticked.
    await tabLink(page, "Mental health exercise").click();
    await privateTick(exerciseTab(page)).click();
    await expect(privateTick(exerciseTab(page))).not.toBeChecked();
    await page.reload();
    await expect(privateTick(exerciseTab(page))).not.toBeChecked();
    expect(await read()).toEqual({ exercise: false, checkin: true });
    await tabLink(page, "Daily check-in").click();
    await expect(privateTick(checkinTab(page))).toBeChecked();

    // Sealed: the rows say nothing in clear beyond their kind, day and part.
    const rows: string[] = await page.evaluate(async () => {
      const { db } = await import(/* @vite-ignore */ "/src/data/db.ts" as string);
      return (await db.journal.where("kind").equals("share").toArray()).map((r: Record<string, unknown>) => JSON.stringify({ ...r, id: "", kind: "" }));
    });
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).not.toMatch(/private|true|false/);
  });
});

test.describe("Highlights by touch at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test(`${ENGINE}: words selected (the phone's own handles), a tap on Highlight marks exactly them`, async ({ page }) => {
    test.setTimeout(120_000);
    await unlocked(page, "/journal/exercise");
    await importCards(page);
    const learn = exerciseTab(page).getByRole("article", { name: "Today's card" }).locator('[data-hl-field="learn"]');
    await expect(learn).toBeVisible();
    // A test browser can't long-press to select: the selection is made as the phone's handles leave it.
    await learn.evaluate((el, w) => {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const i = (n as Text).data.indexOf(w);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + w.length);
        document.getSelection()!.removeAllRanges();
        document.getSelection()!.addRange(r);
        return;
      }
    }, HL_WORDS);
    await page.getByRole("button", { name: "Highlight", exact: true }).tap();
    await expect(learn.locator("mark.hl-mark")).toHaveText(HL_WORDS);
    await page.reload();
    await expect(exerciseTab(page).getByRole("article", { name: "Today's card" }).locator("mark.hl-mark")).toHaveText(HL_WORDS);
  });
});
