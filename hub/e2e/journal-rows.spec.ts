import { expect, test, type Page } from "@playwright/test";
import { FAKE_CARD_FILE } from "../src/test/exerciseCards";
import { pageDate } from "./helpers";

/* The Journal rows (VISUAL-LANGUAGE.md "Journal rows (2026-11-02)"; Journal v2) in a real
   browser: three Map mint strips on Home (the exercise first) whose ticks tick themselves, the
   shared streak (this week's bars and the number), tapping a row opens its Journal tab (which
   ticks too), the space under Today, and no sideways scroll on phones. All data is fictional; the sync address is a made-up one
   that never answers. Set SHOTS_DIR to save screenshots. */

const PASS = "fake-journal-e2e-passphrase";
const MINT = "rgb(163, 213, 194)"; // #a3d5c2
const TEXT = "rgb(58, 65, 47)"; // --text #3a412f

async function shoot(page: Page, name: string, fullPage = true) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage });
}

/** Sync set up for PASS and the journal unlocked (as the Sync page and Unlock would). */
async function unlocked(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  await page.evaluate(async (pass) => {
    const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
    const engine = await at("/src/sync/engine.ts");
    const token = await at("/src/sync/token.ts");
    const keys = await at("/src/journal/keyStore.ts");
    const { db } = await at("/src/data/db.ts");
    await engine.saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: await token.deriveToken(pass) });
    await db.syncMeta.put({ key: "acceptedToken", value: (await db.syncMeta.get("token")).value });
    await keys.unlockJournal(db, pass);
  }, PASS);
}

/**
 * Pretend history through the app's own repo: morning pages the last 6 days and today (★ 7,
 * ticked); check-in finished the 3 days before today, not yet today (★ 3, not ticked);
 * cards imported and today's marked done (★ 1, ticked). Plus two to-dos due today.
 */
async function pretendHistory(page: Page) {
  const days = await Promise.all([0, -1, -2, -3, -4, -5, -6].map((o) => pageDate(page, o)));
  await page.evaluate(
    async ({ days, cards }) => {
      const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
      const repo = await at("/src/data/repo.ts");
      const keys = await at("/src/journal/keyStore.ts");
      const exercise = await at("/src/journal/exercise.ts");
      const { db } = await at("/src/data/db.ts");
      const jk = (await keys.loadJournalKey(db))!;
      const other = "e2e-pretend-other-device";
      for (const d of days) await repo.finishMorningPage(jk, d, other, "Pretend page");
      for (const d of days.slice(1, 4)) {
        await repo.ensureCheckinSet(jk, d, ["K2"]);
        await repo.saveAnswer(jk, d, "K2", other, "Pretend answer", true);
      }
      await repo.importExerciseCards(jk, exercise.checkCardFile(cards), days[6]);
      await repo.saveExerciseMark(jk, days[0], other, "day-1", true);
      for (const title of ["Water the pretend fern", "Post the made-up letter"]) {
        await repo.createItem({ kind: "task", title, areaId: "body", priority: 3, due: days[0] }, days[0]);
      }
    },
    { days, cards: FAKE_CARD_FILE },
  );
}

const journal = (page: Page) => page.getByRole("list", { name: "Journal" });
const row = (page: Page, title: string) => journal(page).locator("li.journal-row").filter({ hasText: title });

async function noSidewaysScroll(page: Page) {
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(m.s).toBeLessThanOrEqual(m.w);
}

async function homeRows(page: Page, prefix: string) {
  await unlocked(page);
  await pretendHistory(page);
  await page.goto("/");
  const morning = row(page, "Morning pages");
  await expect(journal(page).locator("li.journal-row")).toHaveCount(3);
  await expect(journal(page).locator("li.journal-row .strip-title")).toHaveText(["Mental health exercise", "Morning pages", "Daily check-in"]);
  for (const t of ["Morning pages", "Daily check-in", "Mental health exercise"]) {
    expect(await row(page, t).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(MINT);
  }
  await expect(morning.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  await expect(morning.getByRole("checkbox")).toHaveText("✓"); // controller call: visible on mint
  expect(await morning.locator(".tick-auto").evaluate((el) => getComputedStyle(el).color)).toBe(TEXT);
  await expect(morning.locator(".streak .streak-n")).toHaveText("7");
  await expect(morning.locator(".streak .streak-day")).toHaveCount(7);
  await expect(morning.locator(".streak .streak-day.on")).toHaveCount(7);
  // Undone bars are --panel on the mint row; done ones the bar green.
  expect(await morning.locator(".streak-day.on").first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(152, 194, 147)");
  await expect(morning.getByText("7 days in a row")).toBeAttached();
  await expect(morning.locator(".journal-star")).toHaveCount(0);
  const checkin = row(page, "Daily check-in");
  await expect(checkin.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
  await expect(checkin.getByText("3 days in a row")).toBeAttached();
  await expect(checkin.locator(".streak-day.on")).toHaveCount(3);
  expect(await checkin.locator(".streak-day:not(.on)").last().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(233, 227, 214)");
  const exercise = row(page, "Mental health exercise");
  await expect(exercise.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  await expect(exercise.getByText("Day 1 · Pretend weather")).toBeVisible();
  await expect(page.getByText("Water the pretend fern")).toBeVisible();
  await noSidewaysScroll(page);
  await shoot(page, `${prefix}-home`);

  // The tick is read-only: clicking it changes nothing here (it opens the section instead).
  const before = await page.evaluate(async () => {
    const at = (path: string): Promise<any> => import(/* @vite-ignore */ path);
    const { db } = await at("/src/data/db.ts");
    return db.journal.count();
  });
  await checkin.getByRole("checkbox").click({ force: true }); // aria-disabled: a person can still tap it
  await expect(page).toHaveURL(/\/journal\/check-in$/);
  const after = await page.evaluate(async () => {
    const at = (path: string): Promise<any> => import(/* @vite-ignore */ path);
    const { db } = await at("/src/data/db.ts");
    return db.journal.count();
  });
  expect(after - before).toBeLessThanOrEqual(1); // at most the check-in's own first-open question set
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("role"))).not.toBe("checkbox");

  // Tapping a row opens its tab, which shows the same tick and streak.
  await page.goto("/");
  await row(page, "Mental health exercise").getByRole("button", { name: "Mental health exercise" }).click();
  await expect(page).toHaveURL(/\/journal\/exercise$/);
  const tabs = page.getByRole("navigation", { name: "Journal parts" });
  const exTab = tabs.getByRole("link", { name: /Mental health exercise/ });
  await expect(exTab).toHaveAttribute("aria-current", "page");
  expect(await exTab.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(MINT);
  await expect(exTab.locator(".tick-auto.is-done")).toBeVisible();
  await expect(page.getByRole("region", { name: "Mental health exercise" })).toBeVisible();
  const morningTab = tabs.getByRole("link", { name: /Morning pages/ });
  await expect(morningTab.locator(".tick-auto.is-done")).toBeVisible();
  await expect(morningTab.getByText("7 days in a row")).toBeAttached();
  await noSidewaysScroll(page);
  await shoot(page, `${prefix}-journal-top`, false);
}

test.describe("at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Home's three mint rows: ticks, streaks, tapping opens the tab", async ({ page }) => {
    test.setTimeout(120_000);
    await homeRows(page, "journalrows-1280");
  });

  test("locked: the rows still show, unticked, and open the Journal to unlock", async ({ page }) => {
    await page.goto("/");
    await expect(journal(page).locator("li.journal-row")).toHaveCount(3);
    // Unknown, not "not done": no checkboxes, three empty boxes that say why.
    await expect(journal(page).getByRole("img", { name: "Not available until the journal is unlocked" })).toHaveCount(3);
    await expect(journal(page).getByRole("checkbox")).toHaveCount(0);
    await expect(journal(page).locator(".streak")).toHaveCount(0);
    await row(page, "Morning pages").getByRole("button", { name: "Morning pages" }).click();
    await expect(page).toHaveURL(/\/journal\/morning$/);
    await expect(page.getByRole("heading", { name: "Unlock journal" })).toBeVisible();
  });
});

test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("Home's three mint rows on the phone, and the Journal's tabs", async ({ page }) => {
    test.setTimeout(120_000);
    await homeRows(page, "journalrows-390");
  });
});

for (const width of [360, 430]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });
    test("Home with the Journal rows does not scroll sideways", async ({ page }) => {
      await unlocked(page);
      await pretendHistory(page);
      await page.goto("/");
      await expect(row(page, "Mental health exercise").getByText("Day 1 · Pretend weather")).toBeVisible();
      await noSidewaysScroll(page);
      await page.goto("/journal");
      await expect(page.getByRole("navigation", { name: "Journal parts" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Mental health exercise" })).toBeVisible();
      await noSidewaysScroll(page);
    });
  });
}
