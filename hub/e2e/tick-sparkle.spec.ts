import { expect, test, type Page } from "@playwright/test";
import { pageDate, skipWhatIDid } from "./helpers";

/* The tick celebration (Esme, 2026-11-17, option C "Pixel sparkles") in a real browser: it plays
   on the ticked strip's box, three bursts, and is gone after 0.5 s; calm: one still frame for
   0.3 s. All data is fictional. */

type Row = Record<string, unknown>;

async function seed(page: Page, items: Row[]) {
  await page.evaluate(async (is) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open("life-hub");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(["items"], "readwrite");
      for (const r of is) tx.objectStore("items").put(r);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, items);
}

async function seedToday(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const today = await pageDate(page);
  const task = (id: string, title: string, extra: Row = {}): Row => ({
    id, kind: "task", title, links: [], areaId: "art", priority: 3, status: "open",
    createdAt: today, touchedAt: today, pinnedDate: today, ...extra,
  });
  await seed(page, [
    task("s1", "Pretend first thing"),
    task("s2", "Pretend second thing"),
    task("s3", "Pretend third thing"),
  ]);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Mark done: Pretend second thing" })).toBeVisible();
}

/** Watches the sparkle layer: where it was put, how many bursts showed, and how long it stayed. */
async function watchSparkle(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { sparkle: { added?: number; removed?: number; left?: string; top?: string; bursts: number; frames: Set<string> } };
    w.sparkle = { bursts: 0, frames: new Set() };
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n instanceof HTMLElement && n.dataset.testid === "tick-sparkle") {
            w.sparkle.added = performance.now();
            w.sparkle.left = n.style.left;
            w.sparkle.top = n.style.top;
            w.sparkle.bursts = n.children.length;
            for (const px of Array.from(n.children) as HTMLElement[]) {
              new MutationObserver(() => w.sparkle.frames.add(px.style.backgroundPosition)).observe(px, { attributes: true });
            }
          }
        }
        for (const n of r.removedNodes) {
          if (n instanceof HTMLElement && n.dataset.testid === "tick-sparkle") w.sparkle.removed = performance.now();
        }
      }
    }).observe(document.body, { childList: true });
  });
}

const read = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { sparkle: { added?: number; removed?: number; left?: string; top?: string; bursts: number; frames: Set<string> } }).sparkle;
    return { ...s, frames: [...s.frames], lasted: s.removed !== undefined && s.added !== undefined ? s.removed - s.added : undefined };
  });

test.describe("tick sparkle", () => {
  test("plays on the ticked strip's box, three bursts of three frames, gone after 0.5 s; never takes a click", async ({ page }) => {
    await seedToday(page);
    await watchSparkle(page);
    const box = page.getByRole("checkbox", { name: "Mark done: Pretend second thing" });
    const at = (await box.boundingBox())!;
    await box.click();
    await expect.poll(async () => (await read(page)).added).toBeDefined();
    // While it plays it never takes a click: the strip just under it can still be ticked.
    const layer = page.getByTestId("tick-sparkle");
    if (await layer.count()) expect(await layer.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe("none");
    await expect.poll(async () => (await read(page)).removed, { timeout: 2000 }).toBeDefined();
    const s = await read(page);
    expect(parseFloat(s.left!)).toBeCloseTo(at.x + at.width / 2, 0);
    expect(parseFloat(s.top!)).toBeCloseTo(at.y + at.height / 2, 0);
    expect(s.bursts).toBe(3);
    expect(s.frames).toEqual(expect.arrayContaining(["0px 0px", "-60px 0px", "-120px 0px"]));
    expect(s.lasted!).toBeGreaterThanOrEqual(480);
    expect(s.lasted!).toBeLessThan(700);
    await expect(page.getByTestId("tick-sparkle")).toHaveCount(0);
  });

  test("the sprite is the farm's fx-sparkle at 2x, pixelated, and nothing in the list moves", async ({ page }) => {
    await seedToday(page);
    const third = page.getByRole("checkbox", { name: "Mark done: Pretend third thing" });
    const before = (await third.boundingBox())!;
    await page.getByRole("checkbox", { name: "Mark done: Pretend first thing" }).click();
    const px = page.locator(".tick-sparkle-px").first();
    await expect(px).toBeAttached();
    const style = await px.evaluate((e) => {
      const c = getComputedStyle(e);
      return { w: c.width, h: c.height, r: c.imageRendering, bg: c.backgroundImage, size: c.backgroundSize };
    });
    expect(style).toMatchObject({ w: "60px", h: "60px", r: "pixelated", size: "180px 60px" });
    expect(style.bg).toMatch(/fx-sparkle/);
    // The third strip only moves up when the ticked one leaves the list, never down for a box.
    const after = (await third.boundingBox())!;
    expect(after.y).toBeLessThanOrEqual(before.y);
  });

  test("calm (reduced motion): one still frame for 0.3 s, then gone", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedToday(page);
    await watchSparkle(page);
    await page.getByRole("checkbox", { name: "Mark done: Pretend second thing" }).click();
    await expect.poll(async () => (await read(page)).removed, { timeout: 2000 }).toBeDefined();
    const s = await read(page);
    expect(s.bursts).toBe(1);
    expect(s.frames.filter((f) => f !== "")).toEqual([]); // set before it was shown: no frame changes
    expect(s.lasted!).toBeGreaterThanOrEqual(280);
    expect(s.lasted!).toBeLessThan(500);
  });

  test("unticking plays nothing", async ({ page }) => {
    await seedToday(page);
    await page.getByRole("checkbox", { name: "Mark done: Pretend second thing" }).click();
    await expect(page.getByTestId("tick-sparkle")).toHaveCount(0, { timeout: 2000 });
    await skipWhatIDid(page);
    await page.locator("summary", { hasText: "Done today" }).click();
    await watchSparkle(page);
    await page.getByRole("checkbox", { name: "Done: Pretend second thing" }).click();
    await expect(page.getByRole("checkbox", { name: "Mark done: Pretend second thing" })).toBeVisible();
    await page.waitForTimeout(300);
    expect((await read(page)).added).toBeUndefined();
  });
});
