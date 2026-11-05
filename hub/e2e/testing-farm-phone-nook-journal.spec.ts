import { expect, test, type Page } from "@playwright/test";

/* Testing session (farm x journal), phone width, real browser: the phone nook (fixed bottom
   left) never covers a box she writes in on the Journal, so a tap meant for the box never opens
   the farm instead. FICTIONAL words; a fresh browser context; the sync address never answers. */

const ENGINE = process.env.E2E_ENGINE === "chromium" ? "chromium" : "webkit";
test.use(ENGINE === "webkit" ? { browserName: "webkit", channel: "" } : {});
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
const PASS = "fake-farm-phone-nook-passphrase";

async function unlocked(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
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
}

/** Whether any part of the box's visible area sits under the nook (sampled every 4 px). */
const coveredPoints = (page: Page, label: string) =>
  page.evaluate((label) => {
    const box = [...document.querySelectorAll("textarea, input")].find((el) => el.getAttribute("aria-label") === label ||
      (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent === label)) as HTMLElement | undefined;
    const nook = document.querySelector(".farm-nook.is-phone") as HTMLElement | null;
    if (!box || !nook) return { found: !!box, nook: !!nook, covered: 0 };
    const b = box.getBoundingClientRect();
    const n = nook.getBoundingClientRect();
    let covered = 0;
    for (let x = Math.max(b.left, n.left); x < Math.min(b.right, n.right); x += 4)
      for (let y = Math.max(b.top, n.top, 0); y < Math.min(b.bottom, n.bottom, innerHeight); y += 4) {
        const hit = document.elementFromPoint(x, y);
        if (hit && nook.contains(hit)) covered++;
      }
    return { found: true, nook: true, covered };
  }, label);

for (const [tab, label] of [["morning", "Today's morning page"], ["check-in", "Your answer"]] as const) {
  test(`${ENGINE}: phone, Journal ${tab}: the nook never sits over the box at any scroll position`, async ({ page }) => {
    await unlocked(page);
    await page.goto(`/journal/${tab}`);
    const box = page.getByLabel(label).first();
    await expect(box).toBeVisible();
    const results: { scroll: number; covered: number }[] = [];
    const max = await page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight);
    for (let s = 0; s <= max + 1; s += 60) {
      await page.evaluate((s) => window.scrollTo(0, s), s);
      const r = await coveredPoints(page, label);
      expect(r.found && r.nook).toBe(true); // both really on the page
      results.push({ scroll: s, covered: r.covered });
    }
    test.info().annotations.push({ type: "samples", description: `${results.length} scroll positions, max ${max}` });
    expect(results.filter((r) => r.covered > 0)).toEqual([]);
  });
}
