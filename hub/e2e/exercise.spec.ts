import { expect, test, type Page } from "@playwright/test";
import { FAKE_CARD_TEXT } from "../src/test/exerciseCards";

/* The Journal's "Mental health exercise" in a real browser: Import, today's card, Done,
   the next one anyway, All cards, and no sideways scroll on phones. The cards are a
   FICTIONAL fixture; the sync address is a made-up one that never answers. Set SHOTS_DIR
   to save screenshots. */

const PASS = "fake-journal-e2e-passphrase";

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
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
  await page.goto("/journal");
}

const section = (page: Page) => page.getByRole("region", { name: "Mental health exercise" });

async function importCards(page: Page) {
  await section(page).getByLabel("Exercise card file").setInputFiles({
    name: "pretend-cards.json",
    mimeType: "application/json",
    buffer: Buffer.from(FAKE_CARD_TEXT),
  });
}

async function noSidewaysScroll(page: Page) {
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(m.s).toBeLessThanOrEqual(m.w);
}

async function walkThrough(page: Page, prefix: string) {
  await unlocked(page);
  const s = section(page);
  await expect(s.getByText("Add your exercise cards")).toBeVisible();
  await s.scrollIntoViewIfNeeded();
  await shoot(page, `${prefix}-empty`);

  await importCards(page);
  await expect(s.getByText("Pretend weather")).toBeVisible();
  await expect(s.locator("em", { hasText: "pretend" })).toBeVisible();
  await expect(s.getByText("In your book: Pretend workbook, page 1")).toBeVisible();
  await shoot(page, `${prefix}-today`);

  await s.getByRole("checkbox", { name: "Done" }).check();
  await expect(s.getByText("Done for today · next card tomorrow")).toBeVisible();
  await s.getByRole("button", { name: "Star this card" }).first().click();
  await expect(s.getByRole("button", { name: "Star this card" }).first()).toHaveAttribute("aria-pressed", "true");
  await s.getByRole("button", { name: "Show the next one anyway" }).click();
  await expect(s.getByRole("article", { name: "Next card" }).getByText("The fictional kettle")).toBeVisible();
  await expect(s.getByText("Good one to bring to a session")).toBeVisible();
  await shoot(page, `${prefix}-done`);

  await s.getByText("All cards", { exact: true }).click();
  await s.getByText("Day 3 · Imaginary pebbles").click();
  await expect(s.getByText(/one small pebble at a time/)).toBeVisible();
  await shoot(page, `${prefix}-all-cards`);
  await noSidewaysScroll(page);

  // Stored sealed: no card text in clear.
  const rows = await page.evaluate(async () => {
    const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
    const { db } = await at("/src/data/db.ts");
    return JSON.stringify(await db.journal.toArray());
  });
  expect(rows).not.toContain("Pretend");
  expect(rows).not.toContain("pebble");

  // Reloaded: still today's card, ticked.
  await page.reload();
  await expect(section(page).getByText("Done for today · next card tomorrow")).toBeVisible();
  await expect(section(page).getByRole("checkbox", { name: "Done" })).toBeChecked();
}

test.describe("at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test("import, today's card, done, the next one, all cards", async ({ page }) => {
    test.setTimeout(120_000);
    await walkThrough(page, "exercise-1280");
  });
});

test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("import, today's card, done, the next one, all cards", async ({ page }) => {
    test.setTimeout(120_000);
    await walkThrough(page, "exercise-390");
  });
});

for (const width of [360, 390, 430]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });
    test("the exercise cards do not scroll sideways", async ({ page }) => {
      await unlocked(page);
      await expect(section(page).getByText("Add your exercise cards")).toBeVisible();
      await noSidewaysScroll(page);
      await importCards(page);
      const s = section(page);
      await expect(s.getByText("Pretend weather")).toBeVisible();
      await noSidewaysScroll(page);
      await s.getByRole("checkbox", { name: "Done" }).check();
      await s.getByRole("button", { name: "Show the next one anyway" }).click();
      await s.getByText("All cards", { exact: true }).click();
      for (const name of ["Day 1 · Pretend weather", "Day 4 · A pretend lighthouse", "Day 5 · The made-up garden"]) {
        await s.getByText(name).click();
      }
      await expect(s.getByText(/doesn't chase the boats/)).toBeVisible();
      await noSidewaysScroll(page);
    });
  });
}
