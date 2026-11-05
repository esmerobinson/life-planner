import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* The Journal in a real browser (Journal v2 tabs): unlock, the morning pages box and calendar,
   Add photo instead (downscaled, sealed, shown blurred), the check-in, and no sideways scroll
   on phones. All data is
   fictional; the sync address is a made-up one that never answers. Set SHOTS_DIR to save
   screenshots. */

const PASS = "fake-journal-e2e-passphrase";

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

/** Stores a sync token for PASS (as the Sync page's Save does), without the journal key. */
async function syncSetUp(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  await page.evaluate(async (pass) => {
    const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
    const engine = await at("/src/sync/engine.ts");
    const token = await at("/src/sync/token.ts");
    const { db } = await at("/src/data/db.ts");
    await engine.saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: await token.deriveToken(pass) });
    // The made-up address never answers: record the token as accepted, as a real first sync would.
    // The journal was set up on another device: its check row is here (an acceptance
    // recorded before the key is typed no longer confirms it, bug #4).
    const jkey = await at("/src/test/journalKey.ts");
    await db.journal.put(await jkey.verifierRow(await jkey.keyFor(pass)));
  }, PASS);
}

/** Pretend finished pages on earlier days (through the app's own repo, sealed with the stored key). */
async function pastPages(page: Page, offsets: number[]) {
  const dates = await Promise.all(offsets.map((o) => pageDate(page, o)));
  await page.evaluate(async (ds) => {
    const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
    const repo = await at("/src/data/repo.ts");
    const keys = await at("/src/journal/keyStore.ts");
    const { db } = await at("/src/data/db.ts");
    const key = (await keys.loadJournalKey(db))!;
    for (const d of ds) await repo.finishMorningPage(key, d, "e2e-other-device", "Pretend earlier page");
  }, dates);
}

async function choosePhoto(page: Page) {
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1800;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f3e4c8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#3a412f";
    ctx.lineWidth = 6;
    for (let y = 140; y < canvas.height; y += 90) {
      ctx.beginPath();
      ctx.moveTo(120, y);
      for (let x = 120; x < canvas.width - 120; x += 40) ctx.lineTo(x, y + Math.sin(x / 30 + y) * 14);
      ctx.stroke();
    }
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Photo of today\'s pages"]')!;
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "pretend-pages.png", { type: "image/png" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function storedRows(page: Page, store: "journal" | "files") {
  return page.evaluate(async (name) => {
    const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
    const { db } = await at("/src/data/db.ts");
    return db.table(name).toArray();
  }, store);
}

async function walkThrough(page: Page, prefix: string) {
  await syncSetUp(page);
  await page.goto("/journal");
  await expect(page.getByRole("heading", { name: "Unlock journal" })).toBeVisible();
  await shoot(page, `${prefix}-unlock`);
  await page.getByLabel("Sync passphrase").fill("fake-wrong-passphrase");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("alert")).toContainText("doesn't open your journal");
  await page.getByLabel("Sync passphrase").fill(PASS);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("Add your exercise cards")).toBeVisible(); // open, on the exercise tab
  await expect(page).toHaveURL(/\/journal\/exercise$/);

  await pastPages(page, [-1, -2, -3, -6, -7]);
  await page.goto("/journal/morning");
  const cal = page.getByRole("group", { name: "Morning pages calendar" });
  await expect(cal).toBeVisible();
  await expect(page.locator(".journal-streak")).toContainText("3 days in a row");
  await expect(cal.locator(".journal-day.on")).not.toHaveCount(0);
  await shoot(page, `${prefix}-calendar`);

  await page.getByLabel("Today's morning page").fill(
    "Pretend morning words. The made-up kettle is loud and the pretend cat wants breakfast. Keep the pen moving, no editing.",
  );
  await expect(page.getByText("20 of 1,000 words")).toBeVisible();
  await expect(page.getByText("Keep going if you can — 1,000 is about three pages.")).toBeVisible();
  await shoot(page, `${prefix}-writing`);
  await page.getByRole("button", { name: "I'm done" }).click();
  await expect(page.getByText("Done for today")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("made-up kettle");

  await choosePhoto(page);
  const img = page.locator(".journal-photo");
  await expect(img).toBeVisible({ timeout: 15_000 });
  expect(await img.evaluate((el) => getComputedStyle(el).filter)).toBe("blur(10px)");
  await shoot(page, `${prefix}-done-with-photo`);
  await page.getByRole("button", { name: "Show" }).click();
  expect(await img.evaluate((el) => getComputedStyle(el).filter)).toBe("none");
  await page.getByRole("button", { name: "Hide" }).click();

  // Stored sealed: no plaintext, no JPEG bytes in clear.
  const journal = JSON.stringify(await storedRows(page, "journal"));
  expect(journal).not.toContain("kettle");
  const files = await storedRows(page, "files");
  expect(files).toHaveLength(1);
  expect(files[0]).toMatchObject({ encrypted: true, mime: "image/jpeg" });
  expect(String(files[0].data).startsWith("/9j/")).toBe(false); // a JPEG's base64 would
  expect(Math.max(files[0].width, files[0].height)).toBeLessThanOrEqual(1600);

  await page.getByRole("link", { name: /Daily check-in/ }).click();
  const checkin = page.getByRole("region", { name: "Daily check-in" });
  await expect(checkin.getByRole("img", { name: "Question 1 of 3" })).toBeVisible();
  await checkin.getByLabel("Your answer").fill("Pretend: a bird, the cool sheet, the pretend lamp.");
  await shoot(page, `${prefix}-checkin-question`);
  await checkin.getByRole("button", { name: "Next →" }).click();
  await checkin.getByRole("button", { name: "Skip" }).click();
  await checkin.getByLabel("Your answer").fill("Pretend kind words to myself.");
  await checkin.getByRole("button", { name: "Finish" }).click();
  await expect(checkin.getByText("Checked in for today")).toBeVisible();
  await shoot(page, `${prefix}-checked-in`);
  expect(JSON.stringify(await storedRows(page, "journal"))).not.toContain("Pretend kind");
}

test.describe("at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test("unlock, star calendar, write, photo, check-in", async ({ page }) => {
    test.setTimeout(120_000);
    await walkThrough(page, "journal-1280");
  });

  test("the Home rows open their tabs", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("list", { name: "Journal" }).getByRole("button", { name: "Daily check-in" }).click();
    await expect(page).toHaveURL(/\/journal\/check-in$/);
    await page.goto("/");
    await page.getByRole("list", { name: "Journal" }).getByRole("button", { name: "Morning pages" }).click();
    await expect(page).toHaveURL(/\/journal\/morning$/);
  });
});

test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("unlock, star calendar, write, photo, check-in", async ({ page }) => {
    test.setTimeout(120_000);
    await walkThrough(page, "journal-390");
  });
});

for (const width of [360, 390, 430]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });
    test("the unlocked Journal does not scroll sideways", async ({ page }) => {
      await syncSetUp(page);
      await page.evaluate(async (pass) => {
        const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
        const { db } = await at("/src/data/db.ts");
        const keys = await at("/src/journal/keyStore.ts");
        await keys.unlockJournal(db, pass);
      }, PASS);
      await pastPages(page, [-1, -2]);
      const wide = () => page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
      await page.goto("/journal/morning");
      await expect(page.getByLabel("Today's morning page")).toBeVisible();
      let m = await wide();
      expect(m.s).toBeLessThanOrEqual(m.w);
      await page.goto("/journal/check-in");
      await page.getByText("Choose questions", { exact: true }).click();
      m = await wide();
      expect(m.s).toBeLessThanOrEqual(m.w);
      await page.goto("/journal/read-back");
      await expect(page.locator("button.journal-readback-tile")).toHaveCount(4);
      m = await wide();
      expect(m.s).toBeLessThanOrEqual(m.w);
      // Its parts too (straight in, as "See all" links).
      await page.goto("/journal/read-back?part=morning");
      await expect(page.getByRole("region", { name: "Morning pages", exact: true }).getByText(/Opens on/).first()).toBeVisible();
      m = await wide();
      expect(m.s).toBeLessThanOrEqual(m.w);
    });
  });
}
