import { expect, test, type Page } from "@playwright/test";
import { FAKE_CARD_TEXT_V2 } from "../src/test/exerciseCards";
import { pageDate } from "./helpers";

/* Journal v2 end to end, with a lived-in FICTIONAL journal: the rows on Home, on Today (their
   own Journal section under the to-dos) and in Mind's Habits box; then every Journal tab (the
   exercise with Read more open and "Do the next one", morning pages, the check-in, Read back),
   at 1280 and 390, never scrolling sideways. Set SHOTS_DIR to save screenshots. The sync address
   is a made-up one that never answers. */

const PASS = "fake-journal-e2e-passphrase";

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

async function noSidewaysScroll(page: Page) {
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(m.s).toBeLessThanOrEqual(m.w);
}

/** Unlocked, v2 cards, a week of pretend history, a Mind habit and two to-dos for today. */
async function livedIn(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const days = await Promise.all([0, -1, -2, -3, -4, -5, -6, -30].map((o) => pageDate(page, o)));
  await page.evaluate(
    async ({ pass, cards, days }) => {
      const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
      const engine = await at("/src/sync/engine.ts");
      const token = await at("/src/sync/token.ts");
      const keys = await at("/src/journal/keyStore.ts");
      const repo = await at("/src/data/repo.ts");
      const exercise = await at("/src/journal/exercise.ts");
      const { db } = await at("/src/data/db.ts");
      await engine.saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: await token.deriveToken(pass) });
      await db.syncMeta.put({ key: "acceptedToken", value: (await db.syncMeta.get("token")).value });
      await keys.unlockJournal(db, pass);
      const jk = (await keys.loadJournalKey(db))!;
      const other = "e2e-pretend-other-device";
      const [today, d1, d2, d3, d4, , , old] = days;
      // Morning pages: yesterday and the three days before, and one a month ago (readable now).
      for (const d of [d1, d2, d3, d4]) await repo.finishMorningPage(jk, d, other, "Pretend page");
      await repo.finishMorningPage(jk, old, other, "Pretend: an old page about a made-up garden.");
      // The check-in: yesterday and the day before.
      for (const d of [d1, d2]) {
        await repo.ensureCheckinSet(jk, d, ["K2", "K4"]);
        await repo.saveAnswer(jk, d, "K2", other, "Pretend answer, a walk by a made-up river", true);
        await repo.saveAnswer(jk, d, "K4", other, null, true);
      }
      // The exercise: Day 1 done yesterday (with a response), so today's card is the kettle (parts).
      const set = exercise.parseCardFile(cards);
      await repo.importExerciseCards(jk, set, old);
      await repo.submitExerciseEntry(jk, d1, other, repo.cardRef(set.cards[1]), "Pretend: one small grey cloud floated past.");
      // Her own Mind habit and two to-dos for today.
      const all = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
      await repo.createItem({ kind: "task", title: "Pretend breathing practice", areaId: "mind", priority: 2, recur: all, doneDates: [d1, d2] }, today);
      for (const title of ["Water the pretend fern", "Post the made-up letter"]) {
        await repo.createItem({ kind: "task", title, areaId: "body", priority: 3, due: today }, today);
      }
    },
    { pass: PASS, cards: FAKE_CARD_TEXT_V2, days },
  );
}

async function walk(page: Page, w: number) {
  await livedIn(page);
  const shot = (name: string) => shoot(page, `jv2-${w}-${name}`);

  // Home: the three mint rows, the exercise first.
  await page.goto("/");
  const journal = page.getByRole("region", { name: "Journal" });
  await expect(journal.locator("li.journal-row .strip-title")).toHaveText(["Mental health exercise", "Morning pages", "Daily check-in"]);
  await expect(journal.getByText("Day 2 · The fictional kettle")).toBeVisible();
  await expect(journal.locator("li.journal-row").nth(1).locator(".streak-n")).toHaveText("4");
  await noSidewaysScroll(page);
  await shot("home");

  // Today: a Journal section under the to-dos.
  await page.goto("/today");
  await expect(page.getByText("Water the pretend fern")).toBeVisible();
  await expect(page.getByRole("region", { name: "Journal" }).locator("li.journal-row")).toHaveCount(3);
  await noSidewaysScroll(page);
  await shot("today");

  // Mind: the rows in the Habits box, after her own habit.
  await page.goto("/area/mind");
  const habits = page.getByRole("list", { name: "Habits" });
  await expect(habits.locator("li .strip-title")).toHaveText([/Pretend breathing practice/, "Mental health exercise", "Morning pages", "Daily check-in"]);
  await expect(habits.locator("li.journal-row").nth(1).getByText(/session \d+ of \d+/)).toBeVisible();
  await noSidewaysScroll(page);
  await shot("mind-habits");

  // The exercise tab: Read more open (on yesterday's card under All cards: today's kettle has
  // none), then today's card with parts and Do the next one.
  await habits.getByRole("button", { name: "Mental health exercise" }).click();
  await expect(page).toHaveURL(/\/journal\/exercise$/);
  const ex = page.getByRole("region", { name: "Mental health exercise" });
  const today = ex.getByRole("article", { name: "Today's card" });
  await expect(today.getByText("The fictional kettle")).toBeVisible();
  await expect(today.getByText("Chapter 1 · Pretend basics")).toBeVisible();
  await today.getByLabel("Three pretend places you feel it, 1").fill("Pretend chest");
  await today.getByText("See an example").click();
  await noSidewaysScroll(page);
  await shot("exercise");
  await today.getByRole("button", { name: "Do the next one →" }).click();
  const next = ex.getByRole("article", { name: "Next card: Day 3" });
  await expect(next.getByText("Imaginary pebbles")).toBeVisible();
  await next.getByText("Read more").click();
  await expect(next.getByText("A made-up paragraph about pebbles.")).toBeVisible();
  await next.scrollIntoViewIfNeeded();
  await noSidewaysScroll(page);
  await shot("exercise-next-one-read-more");
  await ex.getByText("All cards", { exact: true }).click();
  const day1 = ex.getByRole("list", { name: "All cards" }).getByRole("listitem").nth(1);
  await day1.getByText("Day 1 · Pretend weather").click();
  await day1.getByText("Read more").click();
  await expect(day1.getByRole("link", { name: "Pretend Cloud Society: About clouds" })).toBeVisible();
  await expect(day1.getByRole("list", { name: "Your responses" }).getByText(/one small grey cloud/)).toBeVisible();
  await noSidewaysScroll(page);
  await shot("exercise-all-cards-read-more");

  // Morning pages.
  await page.getByRole("link", { name: /Morning pages/ }).click();
  await page.getByLabel("Today's morning page").fill("Pretend morning words about a made-up kettle and a pretend cat.");
  await expect(page.getByText(/^\d+ of 1,000 words$/)).toBeVisible();
  await noSidewaysScroll(page);
  await shot("morning");

  // The check-in.
  await page.getByRole("link", { name: /Daily check-in/ }).click();
  await expect(page.getByRole("region", { name: "Daily check-in" }).getByRole("img", { name: /Question 1 of/ })).toBeVisible();
  await noSidewaysScroll(page);
  await shot("check-in");

  // Read back: one list, newest first.
  await page.getByRole("link", { name: "Read back" }).click();
  const list = page.getByRole("list", { name: "Read back" });
  await expect(list.getByText(/Exercise · Day 1 · Pretend weather/)).toBeVisible();
  await expect(list.getByText(/Opens on/).first()).toBeVisible();
  await list.getByText(/Exercise · Day 1 · Pretend weather/).click();
  await noSidewaysScroll(page);
  await shot("read-back");
}

test.describe("at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test("rows on Home, Today and Mind; every Journal tab", async ({ page }) => {
    test.setTimeout(120_000);
    await walk(page, 1280);
  });
});

test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("rows on Home, Today and Mind; every Journal tab", async ({ page }) => {
    test.setTimeout(120_000);
    await walk(page, 390);
  });
});
