import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* ⌘K search (option 3A) in a real browser, at computer and phone width: the pop-up from any
   page, grouped results with bold matches, arrows and Enter, the locked journal line, journal
   results while unlocked (never a morning page under 28 days old), and the phone's 🔍.
   FICTIONAL data only; the sync address is a made-up one that never answers. Set SHOTS_DIR to
   save screenshots. */

const PASS = "fake-journal-search-e2e-passphrase";

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function seed(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const made = await pageDate(page, -10);
  const due = await pageDate(page, 2);
  await page.evaluate(
    async ({ made, due }) => {
      const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
      const repo = await at("/src/data/repo.ts");
      await repo.createItem({ kind: "task", title: "Draw the pretend market stall reference", areaId: "art", priority: 2, due }, made);
      await repo.createItem({ kind: "task", title: "Ask about the pretend Christmas market stall", areaId: "admin", priority: 2 }, made);
      await repo.createItem({ kind: "idea", title: "Pretend market stall zine", areaId: "content", priority: 2 }, made);
      await repo.createBook({ title: "Night Pretend Bazaar", author: "Lena Market", bookStatus: "read" }, made);
      await repo.createGoal({ title: "Sell pretend prints at the Christmas market", areaId: "art", kind: "practice" }, made);
      await repo.createItem(
        { kind: "task", title: "Blender pretend project", areaId: "art", priority: 2, notes: "Reference folder: market photos from the pretend trip" },
        made,
      );
      // Enough rows to feel a real list (about 1,000), none matching "market".
      const many = Array.from({ length: 1000 }, (_, i) => ({ kind: "task", title: `Pretend errand ${i}`, areaId: "admin", priority: 3 }));
      for (const m of many) await repo.createItem(m, made);
    },
    { made, due },
  );
}

/** Sync set up for PASS and the journal unlocked, then pretend entries (one page too recent to search). */
async function unlockedJournal(page: Page) {
  const old = await pageDate(page, -40);
  const recent = await pageDate(page, -3);
  const checkin = await pageDate(page, -2);
  await page.evaluate(
    async ({ pass, old, recent, checkin }) => {
      const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
      const engine = await at("/src/sync/engine.ts");
      const token = await at("/src/sync/token.ts");
      const keys = await at("/src/journal/keyStore.ts");
      const repo = await at("/src/data/repo.ts");
      const { db } = await at("/src/data/db.ts");
      await engine.saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: await token.deriveToken(pass) });
      await db.syncMeta.put({ key: "acceptedToken", value: (await db.syncMeta.get("token")).value });
      await keys.unlockJournal(db, pass);
      const jk = (await keys.loadJournalKey(db))!;
      const other = "e2e-pretend-other-device";
      await repo.ensureCheckinSet(jk, checkin, ["M10"]);
      await repo.saveAnswer(jk, checkin, "M10", other, "The pretend market was crowded and I used paced breathing", true);
      await repo.finishMorningPage(jk, old, other, "The pretend market dream again, the one with the blue stalls");
      await repo.finishMorningPage(jk, recent, other, "A secret recent pretend market page");
    },
    { pass: PASS, old, recent, checkin },
  );
}

for (const width of [1280, 390]) {
  test.describe(`search at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

    test("opens from any page; grouped results with bold matches; arrows and Enter open the side panel", async ({ page }) => {
      await seed(page);
      await page.goto("/area/art");
      await expect(page.getByRole("heading", { name: "Art", level: 1 })).toBeAttached();
      if (width === 390) await shoot(page, "phone-top-bar-search-390");
      if (width === 390) await page.getByRole("button", { name: "Search", exact: true }).click();
      else await page.keyboard.press("ControlOrMeta+k");
      const dialog = page.getByRole("dialog", { name: "Search" });
      await expect(dialog).toBeVisible();
      const box = dialog.getByRole("combobox", { name: "Search" });
      await expect(box).toBeFocused();
      await box.fill("market");
      await expect(dialog.getByRole("group", { name: "To-dos" })).toBeVisible();
      for (const g of ["Ideas", "Books", "Goals", "Notes", "Journal"]) await expect(dialog.getByRole("group", { name: g })).toBeVisible();
      await expect(dialog.locator("mark").first()).toHaveCSS("font-weight", "700");
      await expect(dialog.getByText("Journal results appear when your journal is unlocked.")).toBeVisible();
      await noSideways(page);
      await shoot(page, `search-${width}`);

      const options = dialog.getByRole("option");
      await expect(options.first()).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("ArrowDown");
      await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
      const title = (await options.nth(1).locator(".strip-title").textContent())!;
      await page.keyboard.press("Enter");
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("complementary", { name: title })).toBeVisible();
    });

    test("journal results only while unlocked; never a morning page under 28 days; Escape closes", async ({ page }) => {
      await seed(page);
      await unlockedJournal(page);
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Add", exact: true })).toBeVisible();
      if (width === 390) await page.getByRole("button", { name: "Search", exact: true }).click();
      else await page.keyboard.press("ControlOrMeta+k");
      const dialog = page.getByRole("dialog", { name: "Search" });
      await dialog.getByRole("combobox", { name: "Search" }).fill("market");
      const journal = dialog.getByRole("group", { name: "Journal" });
      await expect(journal.getByRole("option", { name: /pretend market was crowded/ })).toBeVisible();
      await expect(journal.getByRole("option", { name: /blue stalls/ })).toBeVisible();
      await expect(journal.getByText(/secret recent/)).toHaveCount(0);
      await expect(dialog.getByText("Journal results appear when your journal is unlocked.")).toHaveCount(0);
      await journal.scrollIntoViewIfNeeded();
      await shoot(page, `search-journal-${width}`);
      // Nothing about the search was written to the browser's storage.
      const stored = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
      expect(stored).not.toContain("market");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    });
  });
}
