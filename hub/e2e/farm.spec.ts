import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* Esme's Rio (was Esme's Farm, phase 1) in a real browser, at 1280 and 390. All data is
   fictional: a fresh browser context per test, so nothing real is touched. */

const MAP = JSON.parse(readFileSync(new URL("../src/assets/rio/day1/map/map.json", import.meta.url), "utf8")) as {
  canvas: [number, number];
  places: { key: string; hotspot: { rect: [number, number, number, number] } }[];
};
const centreOf = (key: string): [number, number] => {
  const [x, y, w, h] = MAP.places.find((p) => p.key === key)!.hotspot.rect;
  return [x + w / 2, y + h / 2];
};

/** A point on the map canvas, from map pixels to the page. */
async function onMap(page: Page, key: string): Promise<{ x: number; y: number }> {
  const box = (await page.locator(".rio-map canvas").boundingBox())!;
  const s = box.width / MAP.canvas[0];
  const [mx, my] = centreOf(key);
  return { x: mx * s, y: my * s };
}

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

/** The open menu is whole inside the window and nothing on the page scrolls. */
async function expectFits(page: Page) {
  const vp = page.viewportSize()!;
  const m = (await page.locator(".rio-menu").boundingBox())!;
  expect(m.x).toBeGreaterThanOrEqual(0);
  expect(m.y).toBeGreaterThanOrEqual(0);
  expect(m.x + m.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(m.y + m.height).toBeLessThanOrEqual(vp.height + 0.5);
  expect(await page.evaluate(() => [document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth]))
    .toEqual([0, 0]);
}

const pixelated = (page: Page, sel: string) =>
  page.locator(sel).first().evaluate((el) => {
    const s = getComputedStyle(el);
    const w = parseFloat(s.width) / (el as HTMLCanvasElement).width;
    return { rendering: s.imageRendering, scale: w };
  });

for (const width of [1280, 390]) {
  test.describe(`Esme's Rio at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    const phone = width === 390;

    test("the first open starts the farm: Welcome plays in the nook and goes into the book", async ({ page }) => {
      await page.goto("/farm");
      await expect(page.getByRole("heading", { level: 1, name: "Esme's Rio" })).toBeAttached();
      await expect.poll(() => farmRow(page, "seen:hi")).not.toBeNull();
      await expect(page.locator("[data-earned]")).toHaveAttribute("data-earned", "1");
      // Pixel art only at whole-number scales (the menu's pixel text too).
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
      for (const sel of [".rio-menu .bt canvas", ".farm-nook canvas"]) {
        const p = await pixelated(page, sel);
        expect(p.rendering).toBe("pixelated");
        expect(Number.isInteger(p.scale)).toBe(true);
      }
      // The map: crisp (a whole number of device pixels per art pixel, or a whole fraction).
      const m = await pixelated(page, ".rio-map canvas");
      const dpr = await page.evaluate(() => window.devicePixelRatio);
      expect(m.rendering).toBe("pixelated");
      const device = m.scale * dpr;
      const whole = device >= 1 ? device : 1 / device; // layout rounds to 1/64 px
      expect(Math.abs(whole - Math.round(whole))).toBeLessThan(0.01);
      // The sticker book is gone (Esme, 2026-11-17).
      await expect(page.locator(".farm-book")).toHaveCount(0);
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

    test("the menu's Collection: place a ready sticker in Rio; a silhouette gives its hint", async ({ page }) => {
      await startedFarm(page);
      await page.goto("/farm");
      await page.getByRole("navigation", { name: "Game menu" }).getByRole("button", { name: "Collection" }).click();
      const menu = page.getByRole("dialog", { name: "Menu" });
      await menu.getByRole("tab", { name: "Fazenda" }).click();
      await menu.getByRole("button", { name: "Mind: seeds: ready to place" }).click();
      await menu.getByRole("dialog", { name: "Mind: seeds" }).getByRole("button", { name: "Place in Rio" }).click();
      await expect.poll(() => farmRow(page, "placed:seeds-mind")).toMatchObject({ spot: "rio" });
      await expect(menu.getByRole("button", { name: "Mind: seeds: placed in Rio" })).toBeAttached();
      // A silhouette gives a gentle hint.
      await menu.getByRole("button", { name: "Mind: sprout: not yet" }).click();
      await expect(menu.getByRole("dialog", { name: "Mind: sprout" })).toContainText("3 to-dos ticked off in Mind");
      // The menu fits the window whole: nothing scrolls.
      await expectFits(page);
      // Close it; the sticker stands at the fazenda (the keyboard way in).
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await page.getByRole("list", { name: "Places in Rio" }).getByRole("button", { name: "Fazenda" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("list", { name: "Stickers here" }).getByText("Mind: seeds")).toBeAttached();
      await page.getByRole("button", { name: "Back to the map" }).click();
    });

    test("the menu by keyboard: Esc opens it, arrows move along the tabs, Enter opens one, Esc closes it", async ({ page }) => {
      await startedFarm(page);
      await page.goto("/farm");
      await expect(page.getByRole("list", { name: "Places in Rio" })).toBeAttached();
      await page.keyboard.press("Escape");
      const menu = page.getByRole("dialog", { name: "Menu" });
      await expect(menu.getByRole("tab", { name: "Collection" })).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await expect(menu.getByRole("tab", { name: "Noticeboard" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(menu.getByRole("tab", { name: "Noticeboard" })).toHaveAttribute("aria-selected", "true");
      await expect(menu.getByRole("tabpanel")).toContainText("Opens next");
      await expectFits(page);
      for (const tab of ["Wardrobe", "Friends", "Settings"]) {
        await menu.getByRole("tab", { name: tab }).click();
        await expectFits(page);
      }
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
    });

    test("the map: whole on screen; a tap opens the Lagoa house (the visit is noted); Barraca says when it opens", async ({ page }) => {
      await page.goto("/farm");
      const canvas = page.locator(".rio-map canvas");
      await expect(canvas).toBeVisible();
      // A fixed game screen (Esme, 2026-11-17): the whole map on screen, inside the game screen,
      // and the page never scrolls either way.
      const box = (await canvas.boundingBox())!;
      const screenBox = (await page.locator(".game-screen").boundingBox())!;
      const vp = page.viewportSize()!;
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect(box.y).toBeGreaterThanOrEqual(screenBox.y);
      expect(box.width).toBeLessThanOrEqual(vp.width);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
      expect(screenBox.y + screenBox.height).toBeLessThanOrEqual(vp.height + 1);
      expect(await page.evaluate(() => [document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth]))
        .toEqual([0, 0]);
      // Day one: Barraca is next, with its tooltip on hover.
      await canvas.scrollIntoViewIfNeeded();
      await canvas.hover({ position: await onMap(page, "barraca") });
      await expect(page.locator(".rio-tooltip")).toHaveText("Opens on day 3");
      await expect(page.locator(".rio-tooltip")).toBeVisible();
      // A tap on the Lagoa house opens it.
      await canvas.click({ position: await onMap(page, "lagoa-house") });
      await expect(page.locator(".rio-area")).toHaveAttribute("data-scene", "lagoa-house/outside");
      await expect.poll(() => farmRow(page, "visited:lagoa-house")).toMatchObject({ kind: "visited", area: "lagoa-house" });
      const sbox = (await page.locator(".rio-area-layer canvas").boundingBox())!;
      expect(sbox.width).toBeLessThanOrEqual(vp.width);
      expect(sbox.y + sbox.height).toBeLessThanOrEqual(vp.height);
      await page.getByRole("button", { name: "Kitchen" }).click();
      await expect(page.locator(".rio-area")).toHaveAttribute("data-scene", "lagoa-house/kitchen");
      await page.getByRole("button", { name: "Back to the map" }).click();
      await expect(page.getByRole("list", { name: "Places in Rio" }).getByRole("button", { name: "Lagoa house" })).toHaveAttribute("data-status", "open");
    });

    test("reduced motion: the device's setting by default, or hers in Settings for this device", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await startedFarm(page);
      await page.goto("/farm");
      await expect(page.locator(".game-screen")).toHaveClass(/is-still/);
      await page.keyboard.press("Escape");
      const menu = page.getByRole("dialog", { name: "Menu" });
      await menu.getByRole("tab", { name: "Settings" }).click();
      await menu.getByRole("radio", { name: "Full motion" }).click();
      await expect(page.locator(".game-screen")).not.toHaveClass(/is-still/);
      await page.reload();
      await expect(page.locator(".game-screen")).not.toHaveClass(/is-still/);
      expect(await page.evaluate(() => localStorage.getItem("rio-reduced-motion"))).toBe("off");
    });

    test("Bap takes the nook on the Journal once he has arrived; Mr Cat (domino) everywhere else", async ({ page }) => {
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
