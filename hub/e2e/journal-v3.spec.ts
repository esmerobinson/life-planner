import { expect, test, type Page } from "@playwright/test";
import { FAKE_CARD_TEXT_BOOKS } from "../src/test/exerciseCards";

/* Journal v3 in a real browser: the tabs never scroll sideways (stacked on the phone), the
   workbook bars and chapter map, Notes to myself with its daily reread and Hard moment, and
   answer boxes that grow as she types. FICTIONAL cards and words only; the sync address is a
   made-up one that never answers. Set SHOTS_DIR to save screenshots. */

const PASS = "fake-journal-e2e-passphrase";

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

/** Sync set up for PASS and the journal unlocked (as the Sync page and Unlock would). */
async function unlocked(page: Page, path = "/journal") {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  await page.evaluate(async (pass) => {
    const at = (p: string): Promise<any> => import(/* @vite-ignore */ p); // the app's own module (dev server)
    const engine = await at("/src/sync/engine.ts");
    const token = await at("/src/sync/token.ts");
    const keys = await at("/src/journal/keyStore.ts");
    const { db } = await at("/src/data/db.ts");
    await engine.saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: await token.deriveToken(pass) });
    await db.syncMeta.put({ key: "acceptedToken", value: (await db.syncMeta.get("token")).value });
    await keys.unlockJournal(db, pass);
  }, PASS);
  await page.goto(path);
}

async function noSidewaysScroll(page: Page) {
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(m.s).toBeLessThanOrEqual(m.w);
}

const tabsNav = (page: Page) => page.getByRole("navigation", { name: "Journal parts" });

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("the tabs never scroll sideways; stacked as full-width rows on the phone, one row across on the Mac", async ({ page }) => {
      await unlocked(page);
      const nav = tabsNav(page);
      await expect(nav.getByRole("link")).toHaveCount(5);
      const m = await nav.evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth, stacked: el.classList.contains("is-stacked") }));
      expect(m.s).toBeLessThanOrEqual(m.c);
      const boxes = await nav.getByRole("link").evaluateAll((ls) => ls.map((l) => ({ w: Math.round(l.getBoundingClientRect().width), top: Math.round(l.getBoundingClientRect().top) })));
      if (width === 390) {
        expect(m.stacked).toBe(true);
        expect(new Set(boxes.map((b) => b.w)).size).toBe(1); // full-width rows
        expect(boxes[0].w).toBe(m.c);
      } else {
        // VISUAL-LANGUAGE.md "Full, no blank space (2026-11-05)", pick 4 · A: one row of equal columns.
        expect(m.stacked).toBe(false);
        expect(new Set(boxes.map((b) => b.top)).size).toBe(1);
        expect(new Set(boxes.map((b) => b.w)).size).toBe(1);
      }
      // The selected tab is mint.
      const bg = await nav.getByRole("link", { name: "Mental health exercise" }).evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe("rgb(163, 213, 194)");
      await noSidewaysScroll(page);
      await shoot(page, `v3-tabs-${width}`);
    });

    test("workbook bars and the chapter map", async ({ page }) => {
      await unlocked(page);
      const s = page.getByRole("region", { name: "Mental health exercise" });
      await s.getByLabel("Exercise card file").setInputFiles({ name: "pretend-cards.json", mimeType: "application/json", buffer: Buffer.from(FAKE_CARD_TEXT_BOOKS) });
      const today = s.getByRole("article", { name: "Today's card" });
      await today.getByLabel("Your response").fill("Pretend: a made-up answer");
      await today.getByRole("button", { name: "Submit" }).click();
      const bpd = s.getByRole("button", { name: "BPD workbook · Day 2 of 4 · Chapter 1 of 2" });
      await expect(bpd).toBeVisible();
      await expect(s.getByRole("button", { name: "DBT skills · Card 1 of 3 · Chapter 1 of 2" })).toBeVisible();
      await noSidewaysScroll(page);
      await shoot(page, `v3-bars-${width}`);
      await bpd.click();
      const map = page.getByRole("dialog", { name: "Your workbooks" });
      await expect(map.getByRole("button", { name: "BPD" })).toHaveAttribute("aria-pressed", "true");
      await expect(map.getByRole("list", { name: "BPD workbook chapters" }).locator(":scope > .wb-ch")).toHaveCount(2);
      await expect(map.getByRole("button", { name: "Day 2 · Pretend first-book two · up next" })).toBeVisible();
      await noSidewaysScroll(page);
      await shoot(page, `v3-chapter-map-${width}`);
      await map.getByRole("button", { name: "Day 1 · Pretend first-book one · done" }).click();
      await expect(map.getByRole("list", { name: "Your responses" }).getByText("Pretend: a made-up answer")).toBeVisible();
      await noSidewaysScroll(page);
      await shoot(page, `v3-chapter-map-card-${width}`);
      await map.getByRole("button", { name: "← All chapters" }).click();
      await map.getByRole("button", { name: "2 · Pretend river" }).click();
      await expect(map.getByRole("list", { name: "Chapter 2 cards" }).getByRole("button")).toHaveCount(2);
      await shoot(page, `v3-chapter-map-open-${width}`);
      await map.locator(".choose-top").getByRole("button", { name: "Done" }).click();
      // Nothing long on the tab: one "See all chapters" control, no All cards list.
      await expect(s.getByText("All cards", { exact: true })).toHaveCount(0);
      await expect(s.getByRole("button", { name: "See all chapters" })).toBeVisible();
    });

    test("Notes to myself: write, reread today, Hard moment", async ({ page }) => {
      await unlocked(page, "/journal/notes");
      const s = page.getByRole("region", { name: "Notes to myself" });
      await expect(s.getByRole("group", { name: "Why bother" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Notes to myself" }).locator(".tick-auto")).toHaveCount(0);
      await noSidewaysScroll(page);
      await shoot(page, `v3-notes-empty-${width}`);
      await s.getByRole("button", { name: "+ Write your answer: This feeling will last forever" }).click();
      const form = s.getByRole("form", { name: "Your note" });
      await expect(form.getByLabel("When I think…")).toHaveValue("This feeling will last forever");
      await form.getByLabel("What I know when I'm steady…").fill("Pretend: it passed last time, after a pretend sleep and a walk.");
      await form.getByLabel("A skill to try (optional)").fill("Pretend skill");
      await shoot(page, `v3-notes-writing-${width}`);
      await form.getByRole("button", { name: "Save" }).click();
      await expect(s.getByText("Pretend: it passed last time, after a pretend sleep and a walk.").first()).toBeVisible();
      await s.getByRole("button", { name: "+ My own thought" }).click();
      await form.getByLabel("When I think…").fill("Pretend own worry");
      await form.getByLabel("What I know when I'm steady…").fill("Pretend own steady answer");
      await form.getByRole("button", { name: "Save" }).click();
      const top = s.getByRole("group", { name: "To read today" });
      await expect(top.getByRole("checkbox")).toHaveCount(2);
      await top.getByRole("checkbox").first().check();
      await expect(top.getByRole("checkbox").first()).toBeChecked();
      await noSidewaysScroll(page);
      await shoot(page, `v3-notes-${width}`);
      // Stored sealed.
      const rows = await page.evaluate(async () => {
        const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
        const { db } = await at("/src/data/db.ts");
        return JSON.stringify(await db.journal.toArray());
      });
      expect(rows).not.toContain("Pretend");
      // Hard moment, from another tab.
      await page.getByRole("link", { name: /Morning pages/ }).click();
      await page.getByRole("button", { name: "Hard moment" }).click();
      const view = page.getByRole("dialog", { name: "Notes to myself" });
      await expect(view.getByText("Pretend own steady answer")).toBeVisible();
      await expect(view.getByText("This feeling will last forever")).toBeVisible();
      await noSidewaysScroll(page);
      await shoot(page, `v3-hard-moment-${width}`);
    });

    test("answer boxes grow downwards as she types (no inner scrollbar)", async ({ page }) => {
      await unlocked(page, "/journal/check-in");
      const box = page.getByRole("region", { name: "Daily check-in" }).getByLabel("Your answer");
      await expect(box).toBeVisible();
      const before = await box.evaluate((el) => el.getBoundingClientRect().height);
      await box.fill(Array.from({ length: 14 }, (_, i) => `Pretend line ${i + 1} of a long made-up answer.`).join("\n"));
      const after = await box.evaluate((el) => ({ h: el.getBoundingClientRect().height, s: el.scrollHeight, c: el.clientHeight }));
      expect(after.h).toBeGreaterThan(before + 100);
      expect(after.s).toBeLessThanOrEqual(after.c + 1);
      await box.fill("Short");
      const shrunk = await box.evaluate((el) => el.getBoundingClientRect().height);
      expect(Math.round(shrunk)).toBe(Math.round(before)); // never shorter than it started
      await shoot(page, `v3-grow-${width}`);
    });
  });
}
