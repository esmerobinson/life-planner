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
  const box = (await page.locator(".rio-map-layer > canvas").boundingBox())!;
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

/**
 * The full-window game (Esme, 2026-11-17): no sidebar, phone header, Inbox or +; an even plank
 * border on all four sides; every place on the map on screen; nothing scrolls.
 */
async function expectFullWindowGame(page: Page) {
  const vp = page.viewportSize()!;
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.locator(".phone-top")).toHaveCount(0);
  await expect(page.locator(".shell-inbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add" })).toHaveCount(0);
  const v = (await page.locator(".game-view").boundingBox())!;
  const border = [v.x, v.y, vp.width - v.x - v.width, vp.height - v.y - v.height];
  for (const b of border) expect(Math.abs(b - border[0]!)).toBeLessThanOrEqual(1);
  expect(border[0]).toBeGreaterThan(0);
  const box = (await page.locator(".rio-map-layer > canvas").boundingBox())!;
  for (const p of MAP.places) {
    const at = await onMap(page, p.key);
    expect(box.x + at.x, p.key).toBeGreaterThanOrEqual(v.x - 0.5);
    expect(box.x + at.x, p.key).toBeLessThanOrEqual(v.x + v.width + 0.5);
    expect(box.y + at.y, p.key).toBeGreaterThanOrEqual(v.y - 0.5);
    expect(box.y + at.y, p.key).toBeLessThanOrEqual(v.y + v.height + 0.5);
  }
  expect(await page.evaluate(() => [document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth]))
    .toEqual([0, 0]);
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
      test.skip(phone, "no game on the phone, only the collection (Esme, 2026-11-17)");
      await page.goto("/farm");
      await expect(page.getByRole("heading", { level: 1, name: "Esme's Rio" })).toBeAttached();
      await expect.poll(() => farmRow(page, "seen:hi")).not.toBeNull();
      await expect(page.locator("[data-earned]")).toHaveAttribute("data-earned", "1");
      // Pixel art is never smoothed. The nook stays at a whole-number scale; on the phone the menu's
      // pixel text and the map do too. On the desktop the map and menu scale by fractions to fill
      // the window (Esme, 2026-11-17: "a bit bigger"), still nearest-neighbour.
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
      for (const sel of [".rio-menu .bt canvas", ".farm-nook canvas"]) {
        const p = await pixelated(page, sel);
        expect(p.rendering).toBe("pixelated");
        if (phone || sel === ".farm-nook canvas") expect(Number.isInteger(p.scale)).toBe(true);
      }
      const m = await pixelated(page, ".rio-map-layer > canvas");
      const dpr = await page.evaluate(() => window.devicePixelRatio);
      expect(m.rendering).toBe("pixelated");
      if (phone) {
        // The phone's map: crisp (a whole number of device pixels per art pixel, or a whole fraction).
        const device = m.scale * dpr;
        const whole = device >= 1 ? device : 1 / device; // layout rounds to 1/64 px
        expect(Math.abs(whole - Math.round(whole))).toBeLessThan(0.01);
      }
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
      test.skip(phone, "no game on the phone, only the collection (Esme, 2026-11-17)");
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
      await page.getByRole("button", { name: "Boat back to Rio" }).click();
      await expect(page.locator(".rio-map")).toBeVisible();
    });

    test("phase 2a: the new areas open on their days and draw their scenes (dev ?day= jumps the farm day)", async ({ page }) => {
      test.skip(phone, "no game on the phone, only the collection (Esme, 2026-11-17)");
      await startedFarm(page);
      await page.goto("/farm?day=14");
      const places = page.getByRole("list", { name: "Places in Rio" });
      await expect(places.getByRole("button", { name: "Jardim Botânico" })).toHaveAttribute("data-status", "new");
      await expect(places.getByRole("button", { name: "Museum" })).toHaveAttribute("data-status", "next");
      await places.getByRole("button", { name: "Jardim Botânico" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".rio-area")).toHaveAttribute("data-scene", "jardim-botanico/outside");
      await page.getByRole("button", { name: "Orchid house doors" }).click();
      await expect(page.locator(".rio-area")).toHaveAttribute("data-scene", "jardim-botanico/inside");
      // The scene is drawn (not blank) and nothing scrolls.
      await expect.poll(() => page.locator(".rio-area-layer > canvas").evaluate((c) => {
        const x = (c as HTMLCanvasElement).getContext("2d")!.getImageData(0, 0, (c as HTMLCanvasElement).width, (c as HTMLCanvasElement).height).data;
        let n = 0;
        for (let i = 3; i < x.length; i += 4) if (x[i]! > 0) n++;
        return n;
      })).toBeGreaterThan(1000);
      expect(await page.evaluate(() => [document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth]))
        .toEqual([0, 0]);
      await page.getByRole("button", { name: "Out to the avenue" }).click();
      await page.getByRole("button", { name: "Gate (back to the map)" }).click();
      await expect(page.locator(".rio-map")).toBeVisible();
      // Day 200: every drawn area is open; Christ (drawn last) still waits.
      await page.goto("/farm?day=200");
      for (const name of ["Zona Sul", "Quilo", "Sult", "Santa Teresa", "Os Esquilos", "Museum", "Flamengo match"]) {
        const b = page.getByRole("list", { name: "Places in Rio" }).getByRole("button", { name, exact: true });
        await expect(b, name).toHaveAttribute("data-status", /new|open/);
      }
    });

    test("the noticeboard stands on Ipanema's promenade: clicking it opens the menu's Noticeboard; Tab and Enter reach the doors", async ({ page }) => {
      test.skip(phone, "no game on the phone, only the collection (Esme, 2026-11-17)");
      await startedFarm(page);
      await page.goto("/farm?day=3");
      await page.getByRole("list", { name: "Places in Rio" }).getByRole("button", { name: "Ipanema beach" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".rio-area")).toHaveAttribute("data-scene", "ipanema-beach/outside");
      await page.getByRole("button", { name: "Noticeboard" }).click();
      const menu = page.getByRole("dialog", { name: "Menu" });
      await expect(menu.getByRole("tab", { name: "Noticeboard" })).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      // The keyboard way: Tab to the barraca's door, Enter goes in.
      const barraca = page.getByRole("button", { name: "Barraca" });
      for (let i = 0; i < 12 && !(await barraca.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
      await expect(barraca).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator(".rio-area")).toHaveAttribute("data-scene", "barraca/inside");
    });

    test("the menu by keyboard: Esc opens it, arrows move along the tabs, Enter opens one, Esc closes it", async ({ page }) => {
      test.skip(phone, "no game on the phone, only the collection (Esme, 2026-11-17)");
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
      test.skip(phone, "no game on the phone, only the collection (Esme, 2026-11-17)");
      await page.goto("/farm");
      const canvas = page.locator(".rio-map-layer > canvas");
      await expect(canvas).toBeVisible();
      // The game takes the whole window (Esme, 2026-11-17), every place on screen, nothing scrolls.
      const vp = page.viewportSize()!;
      await expectFullWindowGame(page);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      // Day one: Barraca is next, with its tooltip on hover.
      await canvas.scrollIntoViewIfNeeded();
      await canvas.hover({ position: await onMap(page, "barraca") });
      await expect(page.getByRole("tooltip")).toContainText("Barraca");
      await expect(page.getByRole("tooltip")).toContainText("Opens on day 3");
      await expect(page.getByRole("tooltip")).toBeVisible();
      // A place she can visit wears its label and lifts when she points at it (Esme, 2026-11-17).
      expect(await page.locator(".rio-place-label").count()).toBeLessThanOrEqual(1); // day 1: the Lagoa house only (labelled where it fits)
      await canvas.hover({ position: await onMap(page, "lagoa-house") });
      await expect(page.locator(".rio-map")).toHaveAttribute("data-hover", "lagoa-house");
      await expect(page.getByRole("tooltip")).toContainText("Visit");
      expect(await canvas.evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer");
      // A tap on the Lagoa house opens it.
      await canvas.click({ position: await onMap(page, "lagoa-house") });
      await expect(page.locator(".rio-area")).toHaveAttribute("data-scene", "lagoa-house/outside");
      await expect.poll(() => farmRow(page, "visited:lagoa-house")).toMatchObject({ kind: "visited", area: "lagoa-house" });
      const sbox = (await page.locator(".rio-area-layer > canvas").boundingBox())!;
      expect(sbox.x + sbox.width).toBeGreaterThan(0);
      expect(sbox.y).toBeLessThan(vp.height);
      // Doors, not buttons (Esme, 2026-11-17): the kitchen's door, named on hover, goes in.
      const kitchen = page.getByRole("button", { name: "Kitchen" });
      await kitchen.hover();
      await expect(page.getByRole("tooltip")).toHaveText("Kitchen");
      await kitchen.click();
      await expect(page.locator(".rio-area")).toHaveAttribute("data-scene", "lagoa-house/kitchen");
      await page.getByRole("button", { name: "Garden" }).click();
      await page.getByRole("button", { name: "Back to the map" }).click();
      await expect(page.getByRole("list", { name: "Places in Rio" }).getByRole("button", { name: "Lagoa house" })).toHaveAttribute("data-status", "open");
    });

    test("reduced motion: the device's setting by default, or hers in Settings for this device", async ({ page }) => {
      test.skip(phone, "no game on the phone, only the collection (Esme, 2026-11-17)");
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

    test("Back leaves the game for the page she came from", async ({ page }) => {
      await page.goto("/goals");
      await page.locator('.farm-nook a[href="/farm"]').first().click();
      await expect(page.locator(".game-screen")).toBeVisible();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page).toHaveURL(/\/goals$/);
      // Opened directly, Back goes Home.
      await page.goto("/farm");
      await page.getByRole("button", { name: "Back", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/$/);
    });

    test("the phone shows only her collection, full screen: place a sticker; no map, areas or menu", async ({ page }) => {
      test.skip(!phone, "the phone only");
      await startedFarm(page);
      await page.goto("/farm");
      const col = page.getByRole("region", { name: "Your sticker collection" });
      await expect(col).toBeVisible();
      await expect(page.locator(".rio-map")).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Game menu" })).toHaveCount(0);
      await expect(page.locator(".sidebar, .phone-top")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Back", exact: true })).toBeVisible();
      // The first open's Welcome still plays in the nook and is kept.
      await expect.poll(() => farmRow(page, "seen:hi")).not.toBeNull();
      await col.getByRole("tab", { name: "Fazenda" }).click();
      await col.getByRole("button", { name: "Mind: seeds: ready to place" }).click();
      await page.getByRole("dialog", { name: "Mind: seeds" }).getByRole("button", { name: "Place in Rio" }).click();
      await expect.poll(() => farmRow(page, "placed:seeds-mind")).toMatchObject({ spot: "rio" });
      // The panel is whole on screen; nothing scrolls.
      const b = (await col.boundingBox())!;
      const vp = page.viewportSize()!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 0.5);
      expect(await page.evaluate(() => [document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth]))
        .toEqual([0, 0]);
    });

    test("Caetano (id bap) takes the nook on the Journal once he has arrived; Mr Cat (domino) everywhere else", async ({ page }) => {
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

for (const [w, h] of [[2560, 1080]] as const) {
  test(`a very wide window (${w}x${h}): the full-window game keeps every place on screen with an even border`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/farm");
    await expect(page.locator(".rio-map-layer > canvas")).toBeVisible();
    await expectFullWindowGame(page);
  });
}

// Esme, 2026-11-17: "maybe just make it a bit bigger and borders a bit smaller". On the desktop
// the map scales by fractions (nearest-neighbour) to fill the view edge to edge one way, every
// place still on screen, and taps still land on their places.
for (const [w, h] of [[1440, 900], [1280, 800], [2560, 1080]] as const) {
  test(`${w}x${h}: the map fills the view one way, every place on screen, taps still land`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/farm");
    const canvas = page.locator(".rio-map-layer > canvas");
    await expect(canvas).toBeVisible();
    await expectFullWindowGame(page);
    const v = (await page.locator(".game-view").boundingBox())!;
    const c = (await canvas.boundingBox())!;
    expect(c.width >= v.width - 1 || c.height >= v.height - 1).toBe(true);
    expect(await canvas.evaluate((el) => getComputedStyle(el).imageRendering)).toBe("pixelated");
    // The plank border is small: 4 UI px at 3x.
    expect(v.x).toBeLessThanOrEqual(13);
    await canvas.hover({ position: await onMap(page, "barraca") });
    await expect(page.getByRole("tooltip")).toContainText("Opens on day 3");
    await canvas.click({ position: await onMap(page, "lagoa-house") });
    await expect(page.locator(".rio-area")).toHaveAttribute("data-scene", "lagoa-house/outside");
  });
}
