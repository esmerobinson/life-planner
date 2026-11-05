import { expect, test, type Page } from "@playwright/test";

/* Bug #40 in a real browser: a finished check-in whose answers are blank shows every question
   ("No answer saved"), Edit opens a box for each, and her new answers survive a reload. A
   question she skipped stays hidden. FICTIONAL words only; the sync address is a made-up one
   that never answers. Set SHOTS_DIR to save screenshots. */

const PASS = "fake-journal-e2e-passphrase";
const NO_ANSWER = "No answer saved";

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

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

async function noSidewaysScroll(page: Page) {
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(m.s).toBeLessThanOrEqual(m.w);
}

/** Today's saved answers, read from the store. */
const savedAnswers = (page: Page) =>
  page.evaluate(async () => {
    const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
    const repo = await at("/src/data/repo.ts");
    const keys = await at("/src/journal/keyStore.ts");
    const dates = await at("/src/domain/dates.ts");
    const { db } = await at("/src/data/db.ts");
    const day = await repo.readCheckinDay(await keys.loadJournalKey(db), dates.todayISO());
    return day.prompts.map((p: string) => day.answers.get(p)?.answer ?? null);
  });

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("an all-blank finished check-in: every question, Edit, answers kept after a reload", async ({ page }) => {
      await unlocked(page, "/journal/check-in");
      const region = () => page.getByRole("region", { name: "Daily check-in" });
      for (let i = 0; i < 3; i++) {
        await expect(region().getByRole("img", { name: `Question ${i + 1} of 3` })).toBeVisible();
        await region().getByRole("button", { name: i === 2 ? "Finish" : "Next →" }).click(); // left blank
      }
      await expect(region().getByText("Checked in for today")).toBeVisible();
      await page.reload();
      await expect(region().getByText("Checked in for today")).toBeVisible();
      await expect(region().locator(".journal-answers > li")).toHaveCount(3);
      await expect(region().getByText(NO_ANSWER)).toHaveCount(3);
      await noSidewaysScroll(page);
      await shoot(page, `blank-day-finished-${width}`);
      await region().getByRole("button", { name: "Edit" }).click();
      const boxes = region().getByRole("textbox", { name: "Your answer" });
      await expect(boxes).toHaveCount(3);
      const words = ["Pretend: a made-up walk", "Pretend: a pretend phone call", "Pretend: an imaginary cup of tea"];
      for (let i = 0; i < 3; i++) await boxes.nth(i).fill(words[i]!);
      await shoot(page, `blank-day-editing-${width}`);
      await region().getByRole("button", { name: "Save" }).click();
      await expect(region().locator(".journal-answers output")).toHaveText(words);
      await expect.poll(() => savedAnswers(page)).toEqual(words);
      await page.reload();
      await expect(region().locator(".journal-answers output")).toHaveText(words);
      await expect(region().getByText(NO_ANSWER)).toHaveCount(0);
      await shoot(page, `blank-day-after-reload-${width}`);
    });

    test("a skipped question stays hidden; a blank one shows", async ({ page }) => {
      await unlocked(page, "/journal/check-in");
      const s = page.getByRole("region", { name: "Daily check-in" });
      await expect(s.getByRole("img", { name: "Question 1 of 3" })).toBeVisible();
      await s.getByLabel("Your answer").fill("Pretend: the rain on a made-up window");
      await s.getByRole("button", { name: "Next →" }).click();
      await expect(s.getByRole("img", { name: "Question 2 of 3" })).toBeVisible();
      await s.getByRole("button", { name: "Skip" }).click();
      await expect(s.getByRole("img", { name: "Question 3 of 3" })).toBeVisible();
      await s.getByRole("button", { name: "Finish" }).click();
      await expect(s.getByText("Checked in for today")).toBeVisible();
      await expect(s.locator(".journal-answers > li")).toHaveCount(2);
      await expect(s.locator(".journal-answers output")).toHaveText(["Pretend: the rain on a made-up window"]);
      await expect(s.getByText(NO_ANSWER)).toHaveCount(1);
      await noSidewaysScroll(page);
      await shoot(page, `blank-day-mixed-${width}`);
    });
  });
}
