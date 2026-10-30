import { expect, test, type Page } from "@playwright/test";
import { FAKE_CARD_TEXT } from "../src/test/exerciseCards";

/* Journal polish (journal polish brief) in a real browser: the full-width Journal page at
   1280 / 1920, the exercise response (write, Submit, Saved), Past exercises, and no sideways
   scroll on phones. FICTIONAL cards and words only; the sync address is a made-up one that
   never answers. Set SHOTS_DIR to save screenshots. */

const PASS = "fake-journal-e2e-passphrase";

async function shoot(page: Page, name: string, target?: ReturnType<Page["locator"]>) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  if (target) await target.screenshot({ path: `${dir}/${name}.png` });
  else await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

/** Sync set up for PASS (as the Sync page would); the journal not yet unlocked. */
async function syncSetUp(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  await page.evaluate(async (pass) => {
    const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
    const engine = await at("/src/sync/engine.ts");
    const token = await at("/src/sync/token.ts");
    const { db } = await at("/src/data/db.ts");
    await engine.saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: await token.deriveToken(pass) });
    await db.syncMeta.put({ key: "acceptedToken", value: (await db.syncMeta.get("token")).value });
  }, PASS);
}

/** Unlocked, the fictional cards imported, a few earlier morning pages and two earlier responses. */
async function ready(page: Page) {
  await syncSetUp(page);
  await page.evaluate(async ({ pass, cards }) => {
    const at = (path: string): Promise<any> => import(/* @vite-ignore */ path);
    const keys = await at("/src/journal/keyStore.ts");
    const repo = await at("/src/data/repo.ts");
    const dates = await at("/src/domain/dates.ts");
    const engine = await at("/src/sync/engine.ts");
    const exercise = await at("/src/journal/exercise.ts");
    const { db } = await at("/src/data/db.ts");
    await keys.unlockJournal(db, pass);
    const meta = (await db.syncMeta.get(keys.JOURNAL_KEY_META)).value;
    const jk = { key: meta.key, mac: meta.mac, fp: meta.fp };
    const device = await engine.getDeviceId(db);
    const today = dates.todayISO();
    await repo.importExerciseCards(jk, exercise.parseCardFile(cards), dates.addDays(today, -5));
    for (const n of [1, 2, 4]) await repo.finishMorningPage(jk, dates.addDays(today, -n), device, "Pretend page");
    await repo.submitExerciseEntry(jk, dates.addDays(today, -3), device, { day: 1, theme: "Pretend weather" }, "Pretend: a small grey cloud drifted by.");
    await repo.submitExerciseEntry(jk, dates.addDays(today, -2), device, { day: 2, theme: "The fictional kettle" }, "Pretend: my shoulders whistled first.\nThen I breathed.");
  }, { pass: PASS, cards: FAKE_CARD_TEXT });
  await page.goto("/journal");
}

const section = (page: Page, name: string) => page.getByRole("region", { name });
const exercise = (page: Page) => section(page, "Mental health exercise");

async function noSidewaysScroll(page: Page) {
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(m.s).toBeLessThanOrEqual(m.w);
}

/** The content column's inner width (inside .app-content's padding) and each journal card's width. */
async function widths(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main.app-content")!;
    const cs = getComputedStyle(main);
    const column = main.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const cards = [...document.querySelectorAll(".journal-page > .journal-card")].map((c) => c.getBoundingClientRect().width);
    return { column, padding: [cs.paddingLeft, cs.paddingRight], cards };
  });
}

async function submitResponse(page: Page) {
  const s = exercise(page);
  await expect(s.getByText("Imaginary pebbles")).toBeVisible(); // days 1 and 2 were done earlier
  const box = s.getByRole("textbox", { name: "Your response" });
  await box.fill("Pretend: I put down one imaginary pebble.\nIt was a kind word to myself.\nThat counts.");
  await s.getByRole("button", { name: "Submit" }).click();
  await expect(s.getByText("Saved", { exact: true })).toBeVisible();
  await expect(s.getByRole("checkbox", { name: "Done" })).toBeChecked();
  await expect(s.getByText("Done for today · next card tomorrow")).toBeVisible();
}

for (const width of [1280, 1920]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("the unlock screen fills the content column", async ({ page }) => {
      await syncSetUp(page);
      await page.goto("/journal");
      await expect(page.getByRole("heading", { name: "Unlock journal" })).toBeVisible();
      const w = await widths(page);
      expect(w.padding).toEqual(["24px", "24px"]);
      expect(w.cards).toHaveLength(1);
      expect(Math.abs(w.cards[0]! - w.column)).toBeLessThanOrEqual(1);
      await noSidewaysScroll(page);
    });

    test("every section fills the content column; calendar, writing view, response, Past exercises", async ({ page }) => {
      test.setTimeout(120_000);
      await ready(page);
      await expect(section(page, "Morning pages")).toBeVisible();
      await expect(section(page, "Daily check-in")).toBeVisible();
      await expect(exercise(page).getByText("Imaginary pebbles")).toBeVisible();
      const w = await widths(page);
      expect(w.padding).toEqual(["24px", "24px"]);
      expect(w.column).toBeGreaterThan(width - 220 - 48 - 30); // the sidebar and the padding only
      expect(w.cards).toHaveLength(3);
      for (const c of w.cards) expect(Math.abs(c - w.column)).toBeLessThanOrEqual(1);

      // The star calendar: 7 equal columns across the card, cells a fixed ~56px tall.
      const cal = await page.evaluate(() => {
        const cells = [...document.querySelectorAll(".journal-cal .journal-day:not(.blank)")].map((c) => c.getBoundingClientRect());
        const grid = document.querySelector(".journal-cal")!.getBoundingClientRect();
        const card = document.querySelector("#morning-pages-section")!;
        const inner = card.clientWidth - parseFloat(getComputedStyle(card).paddingLeft) - parseFloat(getComputedStyle(card).paddingRight);
        return { heights: [...new Set(cells.map((r) => Math.round(r.height)))], widths: [...new Set(cells.map((r) => Math.round(r.width)))], grid: grid.width, inner };
      });
      expect(cal.heights).toEqual([56]);
      expect(cal.widths.length).toBeLessThanOrEqual(2); // equal columns (sub-pixel rounding)
      expect(Math.abs(cal.grid - cal.inner)).toBeLessThanOrEqual(1);

      // The check-in and exercise boxes fill their cards.
      await expect(section(page, "Daily check-in").getByRole("textbox", { name: "Your answer" })).toBeVisible();
      await expect(exercise(page).getByRole("textbox", { name: "Your response" })).toBeVisible();
      const boxes = await page.evaluate(() =>
        [...document.querySelectorAll(".journal-answer")].map((b) => {
          const card = b.closest(".journal-card")!;
          const inner = card.clientWidth - parseFloat(getComputedStyle(card).paddingLeft) - parseFloat(getComputedStyle(card).paddingRight);
          return { box: b.getBoundingClientRect().width, inner, font: parseFloat(getComputedStyle(b).fontSize) };
        }),
      );
      expect(boxes.length).toBeGreaterThanOrEqual(2);
      for (const b of boxes) expect(Math.abs(b.box - b.inner)).toBeLessThanOrEqual(1);
      const response = exercise(page).getByRole("textbox", { name: "Your response" });
      expect(await response.evaluate((b) => parseFloat(getComputedStyle(b).fontSize))).toBeGreaterThanOrEqual(16);
      // At least six lines tall while empty.
      expect(await response.getAttribute("rows")).toBe("6");
      expect((await response.boundingBox())!.height).toBeGreaterThanOrEqual(6 * 16);

      await submitResponse(page);
      await noSidewaysScroll(page);
      await shoot(page, `journal-${width}`);
      await shoot(page, `exercise-submitted-${width}`, exercise(page));

      // It grows with the text.
      const before = (await response.boundingBox())!.height;
      await response.fill(`${"Pretend line\n".repeat(14)}Pretend last line`);
      expect((await response.boundingBox())!.height).toBeGreaterThan(before);
      await exercise(page).getByRole("button", { name: "Submit" }).click();
      await expect(exercise(page).getByText("Saved", { exact: true })).toBeVisible();

      // Past exercises: newest first; one opens to the card and her response.
      const s = exercise(page);
      await s.getByText("Past exercises", { exact: true }).click();
      const items = s.getByRole("list", { name: "Past exercises" }).getByRole("listitem");
      await expect(items).toHaveCount(2);
      await expect(items.nth(0).locator("summary")).toHaveText(/^Day 2 · The fictional kettle · /);
      await expect(items.nth(1).locator("summary")).toHaveText(/^Day 1 · Pretend weather · /);
      await items.nth(0).locator("summary").click();
      await expect(items.nth(0).getByText(/a kettle whistles before it boils over/)).toBeVisible();
      await expect(items.nth(0).getByText("In your book: Pretend workbook, page 2")).toBeVisible();
      await expect(items.nth(0).getByText(/my shoulders whistled first/)).toBeVisible();
      await noSidewaysScroll(page);
      await shoot(page, `past-exercises-${width}`, s);

      // Stored sealed: none of her words in clear.
      const rows = await page.evaluate(async () => {
        const at = (path: string): Promise<any> => import(/* @vite-ignore */ path);
        const { db } = await at("/src/data/db.ts");
        return JSON.stringify(await db.journal.toArray());
      });
      for (const word of ["Pretend", "pebble", "shoulders"]) expect(rows).not.toContain(word);

      // Write now: the writing view fills the width and at least 60% of the window height.
      await section(page, "Morning pages").getByRole("button", { name: "Write now" }).click();
      const page60 = await page.getByLabel("Today's morning page").evaluate((b) => {
        const card = b.closest(".journal-card")!;
        const inner = card.clientWidth - parseFloat(getComputedStyle(card).paddingLeft) - parseFloat(getComputedStyle(card).paddingRight);
        return { w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height, inner, win: window.innerHeight };
      });
      expect(Math.abs(page60.w - page60.inner)).toBeLessThanOrEqual(1);
      expect(page60.h).toBeGreaterThanOrEqual(page60.win * 0.6 - 1);
      await noSidewaysScroll(page);
    });
  });
}

test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("journal page, submitted response and Past exercises on the phone", async ({ page }) => {
    test.setTimeout(120_000);
    await ready(page);
    await submitResponse(page);
    await noSidewaysScroll(page);
    await shoot(page, "journal-390");
    await shoot(page, "exercise-submitted-390", exercise(page));
    const s = exercise(page);
    await s.getByText("Past exercises", { exact: true }).click();
    await s.getByRole("list", { name: "Past exercises" }).getByRole("listitem").nth(0).locator("summary").click();
    await expect(s.getByText(/my shoulders whistled first/)).toBeVisible();
    await noSidewaysScroll(page);
    await shoot(page, "past-exercises-390", s);
  });
});

for (const width of [360, 430]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });
    test("the journal with a response and Past exercises open does not scroll sideways", async ({ page }) => {
      test.setTimeout(120_000);
      await ready(page);
      await submitResponse(page);
      await noSidewaysScroll(page);
      const s = exercise(page);
      await s.getByText("Past exercises", { exact: true }).click();
      await s.getByRole("list", { name: "Past exercises" }).getByRole("listitem").nth(0).locator("summary").click();
      await expect(s.getByText(/my shoulders whistled first/)).toBeVisible();
      await noSidewaysScroll(page);
    });
  });
}
