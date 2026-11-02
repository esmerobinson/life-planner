import { expect, test, type Page } from "@playwright/test";
import { FAKE_CARD_TEXT } from "../src/test/exerciseCards";
import { pageDate } from "./helpers";

/* Polish round 1 in a real browser, at computer and phone width: Update cards at the top of
   the exercise tab, yesterday's unfinished morning page, and Cancel in a goal's Edit putting
   its month goals back. (The Add form closing is in add-and-rows.spec.ts.) FICTIONAL data
   only; the sync address is a made-up one that never answers. Set SHOTS_DIR to save screenshots. */

const PASS = "fake-journal-e2e-passphrase";

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

async function sideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/** Sync set up for PASS, the journal unlocked on this device, the fictional cards imported. */
async function ready(page: Page, yesterdayDraft?: string) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  await page.evaluate(async ({ pass, cards, draft }) => {
    const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
    const engine = await at("/src/sync/engine.ts");
    const token = await at("/src/sync/token.ts");
    const keys = await at("/src/journal/keyStore.ts");
    const repo = await at("/src/data/repo.ts");
    const dates = await at("/src/domain/dates.ts");
    const exercise = await at("/src/journal/exercise.ts");
    const { db } = await at("/src/data/db.ts");
    await engine.saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: await token.deriveToken(pass) });
    await db.syncMeta.put({ key: "acceptedToken", value: (await db.syncMeta.get("token")).value });
    await keys.unlockJournal(db, pass);
    const meta = (await db.syncMeta.get(keys.JOURNAL_KEY_META)).value;
    const jk = { key: meta.key, mac: meta.mac, fp: meta.fp };
    const device = await engine.getDeviceId(db);
    const today = dates.todayISO();
    await repo.importExerciseCards(jk, exercise.parseCardFile(cards), dates.addDays(today, -5));
    if (draft) await repo.saveMorningDraft(jk, dates.addDays(today, -1), device, draft);
  }, { pass: PASS, cards: FAKE_CARD_TEXT, draft: yesterdayDraft ?? null });
}

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("Update cards sits above the card and opens the file picker", async ({ page }) => {
      test.setTimeout(120_000);
      await ready(page);
      await page.goto("/journal");
      const s = page.getByRole("region", { name: "Mental health exercise" });
      const update = s.getByRole("button", { name: "Update cards" });
      await expect(update).toBeVisible();
      await expect(update).toHaveClass(/btn-secondary/);
      const above = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => x.textContent === "Update cards")!;
        const card = document.querySelector("article.exercise-card")!;
        return b.getBoundingClientRect().bottom <= card.getBoundingClientRect().top;
      });
      expect(above).toBe(true);
      await sideways(page);
      await shoot(page, `update-cards-${width}`);
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), update.click()]);
      expect(chooser.isMultiple()).toBe(false);
    });

    test("yesterday's unfinished page: open it, finish it; Back to today leaves it", async ({ page }) => {
      test.setTimeout(120_000);
      await ready(page, "Pretend unfinished words from yesterday");
      await page.goto("/journal/morning");
      await expect(page.getByText("Yesterday's unfinished page is saved.")).toBeVisible();
      await sideways(page);
      await shoot(page, `yesterday-line-${width}`);

      await page.getByRole("button", { name: "Open yesterday's page" }).click();
      await expect(page.getByText("Finishing yesterday's page")).toBeVisible();
      const box = page.getByLabel("Yesterday's morning page");
      await expect(box).toHaveValue("Pretend unfinished words from yesterday");
      await expect(page.getByText("5 of 1,000 words")).toBeVisible();
      await sideways(page);
      await shoot(page, `yesterday-open-${width}`);

      await page.getByRole("button", { name: "Back to today" }).click();
      await expect(page.getByLabel("Today's morning page")).toBeVisible();
      await expect(page.getByRole("button", { name: "Open yesterday's page" })).toBeVisible();

      await page.getByRole("button", { name: "Open yesterday's page" }).click();
      await expect(box).toHaveValue("Pretend unfinished words from yesterday");
      await page.getByRole("button", { name: "I'm done" }).click();
      await expect(page.getByLabel("Today's morning page")).toHaveValue("");
      await expect(page.getByRole("button", { name: "Open yesterday's page" })).toHaveCount(0);
      await expect(page.getByText("Yesterday's unfinished page is saved.")).toHaveCount(0);
      await sideways(page);
      await shoot(page, `yesterday-finished-${width}`);
      // Filed under yesterday's date, not today's.
      const dates = await page.evaluate(async () => {
        const at = (path: string): Promise<any> => import(/* @vite-ignore */ path);
        const { db } = await at("/src/data/db.ts");
        return (await db.journal.where("kind").equals("page").toArray()).map((r: { date: string }) => r.date);
      });
      expect(dates).toEqual([await pageDate(page, -1)]);
    });

    test("Cancel in a goal's Edit puts its month goals back", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
      const today = await pageDate(page, 0);
      await page.evaluate(
        async ([t]) => {
          const db: IDBDatabase = await new Promise((res, rej) => {
            const r = indexedDB.open("life-hub");
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
          });
          await new Promise<void>((res, rej) => {
            const tx = db.transaction(["goals"], "readwrite");
            tx.objectStore("goals").put({
              id: "gm", title: "Pretend calm", areaId: "mind", kind: "practice", milestones: [], createdAt: t,
              monthGoals: [
                { id: "a", month: t!.slice(0, 7), kind: "count", title: "Sessions", target: 5 },
                { id: "b", month: t!.slice(0, 7), kind: "step", title: "Book a pretend class" },
              ],
            });
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
          });
          db.close();
        },
        [today] as const,
      );
      await page.goto("/goals?open=gm");
      const panel = page.getByRole("complementary", { name: "Pretend calm" });
      await panel.getByRole("button", { name: "Edit" }).click();
      await panel.getByRole("button", { name: "Remove Book a pretend class" }).click();
      await expect(panel.getByText("Book a pretend class")).toHaveCount(0);
      await sideways(page);
      await shoot(page, `goal-edit-removed-${width}`);
      await panel.getByRole("button", { name: "Cancel" }).click();
      await expect(panel.getByText("Book a pretend class")).toBeVisible();
      await expect(panel.getByText("Sessions")).toBeVisible();
      await sideways(page);
      await shoot(page, `goal-edit-cancelled-${width}`);
    });
  });
}
