import { expect, test, type Locator, type Page } from "@playwright/test";
import { FAKE_CARD_TEXT_V2 } from "../src/test/exerciseCards";

/* Testing session (Life Planner - Together-link Testing Round 5), 2026-11-06: times how long Read
   back's tiles take to appear after the steps of the airtight "Highlights at 1280px … add a note"
   test (a highlight made and given a note through the UI, reloads), so the same file can be run
   on together-link and on its base and compared. Each run prints one line "TILE-TIMING {json}":
   ms from the Read back tab click to the Highlights tile, then 5 more opens of Read back after a
   reload, and how many IndexedDB read-write transactions the page started while it waited.
   WebKit by default (E2E_ENGINE=chromium for Chrome). FICTIONAL words; the sync address is a
   made-up one that never answers. */

const PASS = "fake-journal-e2e-passphrase";
const ENGINE = process.env.E2E_ENGINE === "chromium" ? "chromium" : "webkit";
test.use(ENGINE === "webkit" ? { browserName: "webkit", channel: "" } : {});
test.use({ viewport: { width: 1280, height: 900 } });
const RUNS = Number(process.env.R5_TILE_RUNS ?? 5);
const THINK_MS = 1500;
const HL_WORDS = "clouds over a made-up hill";
const HL_NOTE = "Pretend Glimmerfold note: remember this one on a grey pretend day.";

async function unlocked(page: Page, path: string) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
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
  await page.goto(path);
}

const exerciseTab = (page: Page) => page.getByRole("region", { name: "Mental health exercise" });
const tabLink = (page: Page, name: string) => page.getByRole("navigation", { name: "Journal parts" }).getByRole("link", { name: new RegExp(name) });

async function dragSelect(page: Page, within: Locator, words: string) {
  await within.scrollIntoViewIfNeeded();
  const box = await within.evaluate((el, w) => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const i = (n as Text).data.indexOf(w);
      if (i < 0) continue;
      const at = (k: number) => {
        const r = document.createRange();
        r.setStart(n!, k);
        r.setEnd(n!, k + 1);
        return r.getBoundingClientRect();
      };
      const a = at(i);
      const b = at(i + w.length - 1);
      return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2 };
    }
    return null;
  }, words);
  if (!box) throw new Error(`"${words}" isn't on the page`);
  await page.mouse.move(box.x1, box.y1);
  await page.mouse.down();
  await page.mouse.move(box.x2, box.y2, { steps: 12 });
  await page.mouse.up();
}

/** Counts read-write IndexedDB transactions the page starts (installed before any page script). */
const COUNT_WRITES = () => {
  const w = window as unknown as { __rw: number; __rwStores: Record<string, number> };
  w.__rw = 0;
  w.__rwStores = {};
  const orig = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (this: IDBDatabase, names: string | string[], mode?: IDBTransactionMode, ...rest: unknown[]) {
    if (mode === "readwrite") {
      w.__rw++;
      for (const n of Array.isArray(names) ? names : [names]) w.__rwStores[n] = (w.__rwStores[n] ?? 0) + 1;
    }
    return (orig as (...a: unknown[]) => IDBTransaction).call(this, names, mode, ...rest);
  } as typeof orig;
};

/** Logs (in the page) every click's target and point, and every move of the Read back tab for 6 s after load. */
const WATCH = () => {
  const w = window as unknown as { __log: unknown[]; __t0: number };
  w.__log = [];
  w.__t0 = performance.now();
  const t = () => Math.round(performance.now() - w.__t0);
  document.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    w.__log.push({ t: t(), click: (el.closest("a,button")?.textContent ?? el.tagName).slice(0, 40), x: Math.round(e.clientX), y: Math.round(e.clientY), path: location.pathname });
  }, true);
  let last = "";
  const tick = () => {
    const a = [...document.querySelectorAll('nav[aria-label="Journal parts"] a')].find((x) => x.textContent?.includes("Read back"));
    const r = a?.getBoundingClientRect();
    const s = r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}` : "none";
    if (s !== last) w.__log.push({ t: t(), readBackTab: s, loading: !!document.querySelector('.journal-page > p[role="status"]') });
    last = s;
    if (t() < 6000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function timeTile(page: Page): Promise<{ ms: number; writes: number; stores: Record<string, number>; missed?: boolean; log?: unknown[] }> {
  await page.evaluate(() => {
    const w = window as unknown as { __rw: number; __rwStores: Record<string, number> };
    w.__rw = 0;
    w.__rwStores = {};
  });
  const tile = page.locator("button.journal-readback-tile", { hasText: "Highlights" });
  const t0 = Date.now();
  await tabLink(page, "Read back").click();
  let missed = false;
  try {
    await expect(tile).toBeVisible({ timeout: 20_000 });
  } catch {
    missed = true; // the airtight test would wait here until its time limit
  }
  const ms = Date.now() - t0;
  const { writes, stores, log, path } = await page.evaluate(() => {
    const w = window as unknown as { __rw: number; __rwStores: Record<string, number>; __log: unknown[] };
    return { writes: w.__rw, stores: w.__rwStores, log: w.__log, path: location.pathname };
  });
  if (missed) {
    console.log(`TILE-MISSED ${JSON.stringify({ path, log })}`);
    await tabLink(page, "Read back").click(); // a second tap
    await expect(tile).toBeVisible({ timeout: 60_000 });
  }
  return { ms, writes, stores, ...(missed ? { missed, log } : {}) };
}

for (let i = 0; i < RUNS; i++) {
  test(`${ENGINE}: Read back's tiles after a highlight with a note (run ${i + 1})`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(COUNT_WRITES);
    await page.addInitScript(WATCH);
    await unlocked(page, "/journal/exercise");
    await exerciseTab(page).getByLabel("Exercise card file").setInputFiles({ name: "pretend-cards.json", mimeType: "application/json", buffer: Buffer.from(FAKE_CARD_TEXT_V2) });
    const today = exerciseTab(page).getByRole("article", { name: "Today's card" });
    await expect(today.getByText("Pretend weather")).toBeVisible();
    const learn = today.locator('[data-hl-field="learn"]');
    await dragSelect(page, learn, HL_WORDS);
    await page.getByRole("button", { name: "Highlight", exact: true }).click();
    await expect(learn.locator("mark.hl-mark")).toHaveText(HL_WORDS);
    await page.waitForTimeout(THINK_MS);
    await page.reload();
    const mark = exerciseTab(page).getByRole("article", { name: "Today's card" }).locator('[data-hl-field="learn"] mark.hl-mark');
    await expect(mark).toHaveText(HL_WORDS);
    await mark.click();
    const sheet = page.getByRole("dialog", { name: "Highlight" });
    const noteBox = sheet.getByLabel("Note (optional)");
    await noteBox.click();
    await noteBox.pressSequentially(HL_NOTE, { delay: 25 });
    await page.waitForTimeout(THINK_MS);
    await sheet.locator(".hl-quote").click();
    await sheet.locator(".choose-top").getByRole("button", { name: "Done" }).click();
    await expect(sheet).toHaveCount(0);
    await page.waitForTimeout(THINK_MS);
    await page.reload();
    const timings = [await timeTile(page)];
    for (let k = 0; k < 5; k++) {
      await page.goto("/journal/exercise");
      await expect(exerciseTab(page).getByRole("article", { name: "Today's card" })).toBeVisible();
      timings.push(await timeTile(page));
    }
    console.log(`TILE-TIMING ${JSON.stringify({ engine: ENGINE, run: i + 1, ms: timings.map((t) => t.ms), missed: timings.map((t) => !!t.missed), writes: timings.map((t) => t.writes), stores: timings[0]!.stores })}`);
  });
}
