import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* Esme's Farm (phase 1) in a real browser, at 1280 and 390. All data is fictional: a fresh
   browser context per test, so nothing real is touched. */

type Row = Record<string, unknown>;

async function seed(page: Page, rows: [string, Row][]) {
  await page.evaluate(async (rows) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open("life-hub");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(["farm", "items"], "readwrite");
      for (const [table, row] of rows) tx.objectStore(table).put({ ...row, updatedAt: Date.now() });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, rows);
}

const farmRow = (page: Page, id: string) =>
  page.evaluate(async (id) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open("life-hub");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const row = await new Promise((res) => {
      const q = db.transaction("farm").objectStore("farm").get(id);
      q.onsuccess = () => res(q.result ?? null);
    });
    db.close();
    return row as Row | null;
  }, id);

/** A farm started a few days ago, with a ticked Mind to-do (it earns "seeds", ready to place). */
async function startedFarm(page: Page) {
  await page.goto("/today");
  await page.waitForLoadState("networkidle");
  const start = await pageDate(page, -3);
  const ticked = await pageDate(page, -1);
  await seed(page, [
    ["farm", { id: "start:e2e-device", kind: "start", date: start }],
    ["farm", { id: "seen:hi", kind: "seen", sticker: "hi", date: start }],
    ["items", {
      id: "e2e-t1", kind: "task", title: "Pretend Mind task", links: [], areaId: "mind", priority: 2, status: "done",
      completedAt: ticked, createdAt: start, touchedAt: ticked,
    }],
  ]);
}

const pixelated = (page: Page, sel: string) =>
  page.locator(sel).first().evaluate((el) => {
    const s = getComputedStyle(el);
    const w = parseFloat(s.width) / (el as HTMLCanvasElement).width;
    return { rendering: s.imageRendering, scale: w };
  });

for (const width of [1280, 390]) {
  test.describe(`Esme's Farm at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    const phone = width === 390;

    test("the first open starts the farm: Welcome plays in the nook and goes into the book", async ({ page }) => {
      await page.goto("/farm");
      await expect(page.getByRole("heading", { level: 1, name: "Esme's Farm" })).toBeAttached();
      await expect.poll(() => farmRow(page, "seen:hi")).not.toBeNull();
      await expect(page.locator("[data-earned]")).toHaveAttribute("data-earned", "1");
      // The farm is asleep (nothing awake) at a fresh start.
      await expect(page.locator(".farm-scene")).toHaveAttribute("data-awake", "");
      // Pixel art only at whole-number scales.
      for (const sel of [".farm-book canvas", ".farm-scene canvas", ".farm-nook canvas"]) {
        const p = await pixelated(page, sel);
        expect(p.rendering).toBe("pixelated");
        expect(Number.isInteger(p.scale)).toBe(true);
      }
    });

    test("the farm's pixel barn icon is pixel art at a whole-number scale (sidebar, or the phone's Home grid)", async ({ page }) => {
      await page.goto("/");
      const icon = page.locator(phone ? '.phone-app[href="/farm"] img' : '.sidebar-item[href="/farm"] img');
      await expect(icon).toHaveCount(1);
      const p = await icon.evaluate(async (el) => {
        const img = el as HTMLImageElement;
        await img.decode();
        const s = getComputedStyle(img);
        return { rendering: s.imageRendering, scale: parseFloat(s.width) / img.naturalWidth, h: parseFloat(s.height) / img.naturalHeight };
      });
      expect(p.rendering).toBe("pixelated");
      expect(p.scale).toBe(phone ? 2 : 1);
      expect(p.h).toBe(p.scale);
    });

    test("open the book, turn to the beds, place a ready sticker on the farm", async ({ page }) => {
      await startedFarm(page);
      await page.goto("/farm");
      await page.getByRole("button", { name: "Open the book", exact: true }).click();
      await expect(page.locator(".farm-book")).toHaveAttribute("data-spread", "0");
      await page.getByRole("button", { name: "Next page" }).click();
      await expect(page.locator(".farm-book")).toHaveAttribute("data-spread", "1");
      await expect(page.locator(".farm-scene")).toHaveAttribute("data-highlight", "beds");
      const ready = page.getByRole("button", { name: "Mind: seeds: ready to place" });
      await ready.click();
      await page.getByRole("button", { name: "Place on the farm" }).click();
      await expect.poll(() => farmRow(page, "placed:seeds-mind")).toMatchObject({ spot: "seeds-mind" });
      await expect(page.getByRole("button", { name: "Mind: seeds: on the farm" })).toBeAttached();
      // A ghost gives a gentle hint.
      await page.getByRole("button", { name: "Mind: sprout: not yet" }).click();
      await expect(page.getByRole("dialog", { name: "Mind: sprout" })).toContainText("3 to-dos ticked off in Mind");
      if (phone) {
        const m = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(m).toBeLessThanOrEqual(0);
      }
    });

    test("arrow keys turn the pages; a tap on the farm opens its page", async ({ page }) => {
      await startedFarm(page);
      await page.goto("/farm");
      await expect(page.locator(".farm-book")).toHaveAttribute("data-show", "closed");
      await page.keyboard.press("ArrowRight");
      await expect(page.locator(".farm-book")).toHaveAttribute("data-spread", "0");
      await page.locator('.farm-zone-hit[data-zone="meadow"]').dispatchEvent("click");
      await expect(page.locator(".farm-book")).toHaveAttribute("data-spread", "5");
      // The 26-page book (captions, Esme 2026-11-06): Bee things and Hedge flowers fill the Meadow's first spread.
      await expect(page.locator(".farm-scene")).toHaveAttribute("data-highlight", "meadow");
    });

    test("with reduced motion, every animation shows its end frame", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await startedFarm(page);
      await page.goto("/farm");
      await page.getByRole("button", { name: "Open the book", exact: true }).click();
      // No turn frames: straight to the contents.
      await expect(page.locator(".farm-book")).toHaveAttribute("data-show", "spread", { timeout: 50 });
    });

    test("Bap takes the nook on the Journal once he has arrived; Domino everywhere else", async ({ page }) => {
      await page.goto("/today");
      await page.waitForLoadState("networkidle");
      const d = await pageDate(page, -2);
      await seed(page, [
        ["farm", { id: "start:e2e-device", kind: "start", date: d }],
        ...["hi", "seeds-mind", "seeds-art", "daisy", "hen"].map((k) => ["farm", { id: `seen:${k}`, kind: "seen", sticker: k, date: d }] as [string, Row]),
      ]);
      await page.goto("/journal/check-in");
      await expect(page.locator(".farm-nook")).toHaveAttribute("data-host", "bap");
      await page.goto("/today");
      await expect(page.locator(".farm-nook")).toHaveAttribute("data-host", "domino");
      await expect(page.locator(".farm-nook")).toBeVisible();
    });
  });
}
