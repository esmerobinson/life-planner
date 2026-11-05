import { expect, test, type Locator, type Page } from "@playwright/test";
import { FAKE_CARD_TEXT_V2 } from "../src/test/exerciseCards";

/* Testing session (Together link, round-2 recheck), 2026-11-05. Bug #45: "What I learned today"
   in Read back, inside that day's Mental health exercise entry ("What I learned that day"); a
   day with learned words and no card gets its own entry. Word for word, every version shown,
   at 1280 and 390, with the exercise answer in the same entry still word for word and the
   other parts of Read back unaffected. WebKit (the Mac app's engine) by default;
   E2E_ENGINE=chromium for Chrome. FICTIONAL words only; the sync address never answers. */

const PASS = "fake-journal-e2e-passphrase";
const ENGINE = process.env.E2E_ENGINE === "chromium" ? "chromium" : "webkit";
test.use(ENGINE === "webkit" ? { browserName: "webkit", channel: "" } : {});
test.describe.configure({ retries: 2 }); // WebKit's occasional DataCloneError in the set-up's unlock

const THINK_MS = 1500;
const EX_TEXT = "Pretend Quillberry answer: one small grey cloud drifting over the made-up hill.";
const LEARNED_LABEL = "What I learned about BPD or mental health today (optional)";
const MAC_WORDS = "Pretend Harrowgate lesson: a made-up urge rises, peaks, and \"passes\" in about twenty minutes.\nSecond line, after a break.";
const PHONE_WORDS = "Pretend Lindqvane phone lesson: name it to tame it.";
const ONLY_WORDS = "Pretend Morrowfen lesson on a day with no card: opposite action is a pretend skill.";

async function unlocked(page: Page, path: string) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  await page.evaluate(async (pass) => {
    const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
    const engine = await at("/src/sync/engine.ts");
    const token = await at("/src/sync/token.ts");
    const keys = await at("/src/journal/keyStore.ts");
    const { db } = await at("/src/data/db.ts");
    await engine.saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: await token.deriveToken(pass) });
    const jkey = await at("/src/test/journalKey.ts");
    await db.journal.put(await jkey.verifierRow(await jkey.keyFor(pass)));
    await keys.unlockJournal(db, pass);
  }, PASS);
  await page.goto(path);
}

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

const exerciseTab = (page: Page) => page.getByRole("region", { name: "Mental health exercise" });
const tabLink = (page: Page, name: string) => page.getByRole("navigation", { name: "Journal parts" }).getByRole("link", { name: new RegExp(name) });

async function typeLikeAPerson(page: Page, box: Locator, words: string, away?: Locator) {
  await box.click();
  // After the last word, where she clicks to carry on (End only goes to the end of a wrapped line).
  await box.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  await box.pressSequentially(words, { delay: 20 });
  await page.waitForTimeout(THINK_MS);
  if (away) await away.click();
}

/** A version of the day's learned words written on another device (or another day), sealed as the app seals it. */
async function sealedLearned(page: Page, d: string, device: string, text: string) {
  await page.evaluate(async ({ d, device, text }) => {
    const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
    const { db } = await at("/src/data/db.ts");
    const keys = await at("/src/journal/keyStore.ts");
    const c = await at("/src/journal/crypto.ts");
    const jk = await keys.loadJournalKey(db);
    const id = `learned:${d}:${device}_pretendv1`;
    await db.journal.put({ id, kind: "learned", date: d, fp: jk.fp, ...(await c.sealJson(jk.key, { v: 1, text, at: Date.now() + 5 }, c.journalAad(id))) });
  }, { d, device, text });
}

async function readBackPart(page: Page, part: string): Promise<Locator> {
  // A click straight after a reload can land before the app is ready: click until it opens.
  await expect(async () => {
    await tabLink(page, "Read back").click();
    await expect(page).toHaveURL(/\/journal\/read-back/, { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await page.locator("button.journal-readback-tile", { hasText: part }).click();
  const section = page.locator("section.journal-readback-part");
  await expect(section.getByRole("heading", { level: 3, name: part })).toBeVisible();
  return section;
}

async function entry(page: Page, section: Locator, line: string): Promise<Locator> {
  const item = section.locator("details", { has: page.locator(`summary:text-is("${line}")`) });
  await expect(item).toHaveCount(1);
  await item.locator("> summary").click();
  return item;
}

/** Fully on screen: inside the viewport's width, not clipped, and the page doesn't scroll sideways. */
async function readable(page: Page, el: Locator) {
  await el.scrollIntoViewIfNeeded();
  await expect(el).toBeVisible();
  const box = (await el.boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(box.x, "starts off screen").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "runs off the right edge").toBeLessThanOrEqual(vw + 0.5);
  expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), "its text is clipped").toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "the page scrolls sideways").toBe(true);
}

for (const width of [1280, 390]) {
  test.describe(`Read back: what I learned at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

    test(`${ENGINE}: inside the day's exercise entry, both devices' words word for word; a learned-only day has its own entry; the other parts unchanged`, async ({ page }) => {
      test.setTimeout(150_000);
      await unlocked(page, "/journal/exercise");
      const today = await appDay(page);
      const before = await appDay(page, -2);

      // Today's card, submitted like a person.
      await exerciseTab(page).getByLabel("Exercise card file").setInputFiles({ name: "pretend-cards.json", mimeType: "application/json", buffer: Buffer.from(FAKE_CARD_TEXT_V2) });
      const card = exerciseTab(page).getByRole("article", { name: "Today's card" });
      await expect(card.getByText("Pretend weather")).toBeVisible();
      await typeLikeAPerson(page, card.getByLabel("Your response"), EX_TEXT, card.getByRole("heading", { name: "Try this" }));
      await card.getByRole("button", { name: "Submit" }).click();
      await expect(exerciseTab(page).getByText("Day 1 · Pretend weather saved.", { exact: false })).toBeVisible();

      // What she learned today, typed in the box (with a line break), then a click away.
      const box = exerciseTab(page).getByLabel(LEARNED_LABEL);
      const [first, second] = MAC_WORDS.split("\n");
      await typeLikeAPerson(page, box, first!);
      await box.press("Enter");
      await typeLikeAPerson(page, box, second!, exerciseTab(page).getByText(LEARNED_LABEL));
      await expect(box).toHaveValue(MAC_WORDS);
      // The phone's words that day (a version the Mac never saw), and a day with words but no card.
      await sealedLearned(page, today.iso, "device-pretend-phone-1", PHONE_WORDS);
      await sealedLearned(page, before.iso, "device-pretend-phone-1", ONLY_WORDS);
      await page.reload();

      const ex = await readBackPart(page, "Mental health exercise");
      const day = await entry(page, ex, `${today.long} · Day 1 · Pretend weather`);
      const answer = day.locator(".journal-past-answer").first();
      await expect(answer).toHaveText(EX_TEXT);
      const learned = day.locator(".journal-readback-learned");
      await expect(learned.getByText("What I learned that day", { exact: true })).toBeVisible();
      const words = learned.locator(".journal-past-answer");
      await expect(words).toHaveCount(2);
      const texts = await words.evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText));
      expect(texts.sort()).toEqual([MAC_WORDS, PHONE_WORDS].sort());
      for (let i = 0; i < 2; i++) await readable(page, words.nth(i));
      await readable(page, answer);

      const only = await entry(page, ex, `${before.long} · What I learned`);
      await expect(only.locator(".journal-readback-learned .journal-past-answer")).toHaveText(ONLY_WORDS);
      await readable(page, only.locator(".journal-readback-learned .journal-past-answer"));

      // The other parts: no learned words in them.
      for (const part of ["Daily check-in", "Morning pages", "Notes to myself"]) {
        await page.goto("/journal/exercise");
        const s = await readBackPart(page, part);
        await expect(s).not.toContainText("Harrowgate");
        await expect(s).not.toContainText("What I learned");
      }
    });
  });
}
