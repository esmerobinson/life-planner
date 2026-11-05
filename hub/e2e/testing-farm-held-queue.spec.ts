import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* Testing session (farm x journal), real browser (WebKit, the Mac app's engine, by default;
   E2E_ENGINE=chromium for Chrome): stickers earned in or held on the Journal never interrupt it
   (no moment, nothing takes the box's focus) and each one plays and is kept once she leaves.
   FICTIONAL words and data; a fresh browser context per test; the sync address never answers. */

const ENGINE = process.env.E2E_ENGINE === "chromium" ? "chromium" : "webkit";
test.use(ENGINE === "webkit" ? { browserName: "webkit", channel: "" } : {});
test.use({ viewport: { width: 1280, height: 1000 } });

type Row = Record<string, unknown>;
const PASS = "fake-farm-journal-e2e-passphrase";

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

const seenIds = (page: Page) =>
  page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open("life-hub");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rows = await new Promise<Row[]>((res) => {
      const q = db.transaction("farm").objectStore("farm").getAll();
      q.onsuccess = () => res(q.result as Row[]);
    });
    db.close();
    return rows.map((r) => String(r.id)).filter((id) => id.startsWith("seen:")).sort();
  });

const todo = (id: string, areaId: string, day: string): [string, Row] => ["items", {
  id, kind: "task", title: `Pretend ${id}`, links: [], areaId, priority: 2, status: "done",
  completedAt: day, createdAt: day, touchedAt: day,
}];

async function farmWithThreeTodos(page: Page) {
  await page.goto("/today");
  await page.waitForLoadState("networkidle");
  const start = await pageDate(page, -1);
  await seed(page, [["farm", { id: "start:e2e-device", kind: "start", date: start }], todo("e2e-a", "mind", start), todo("e2e-b", "art", start), todo("e2e-c", "body", start)]);
}
const THREE = ["seen:hi", "seen:seeds-art", "seen:seeds-body", "seen:seeds-mind"];
const leave = (page: Page) => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Goals" }).click();

test(`${ENGINE}: control: off the Journal, every sticker earned at once plays and is kept`, async ({ page }) => {
  await farmWithThreeTodos(page);
  await page.goto("/goals");
  await expect.poll(() => seenIds(page), { timeout: 15_000 }).toEqual(expect.arrayContaining(THREE));
});

for (let run = 1; run <= 3; run++) {
  test(`${ENGINE}: held on the Journal, then she clicks Goals: every sticker plays and is kept (run ${run})`, async ({ page }) => {
    await farmWithThreeTodos(page);
    await page.goto("/journal/check-in");
    await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeAttached();
    await page.waitForTimeout(2500);
    expect(await seenIds(page)).toEqual([]);
    await leave(page);
    await page.waitForTimeout(8000); // each moment is 0.6 s with the placeholder timings
    expect(await seenIds(page)).toEqual(expect.arrayContaining(THREE));
  });
}

for (const missingArt of [false, true]) test(`${ENGINE}: finishing a real check-in${missingArt ? ", with every farm picture failing to load" : ""}: nothing plays or takes focus in the Journal; the lily pad arrives once she leaves`, async ({ page }) => {
  // Every farm sprite sheet missing (a broken update, say): the Journal must not care.
  let refused = 0;
  // The pictures themselves (not the dev server's "?url" module that names them).
  if (missingArt) await page.route(/\/assets\/farm\/[^/?]+\.png$/, (r) => (refused++, r.abort()));
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
  const yesterday = await pageDate(page, -1);
  await seed(page, [["farm", { id: "start:e2e-device", kind: "start", date: yesterday }], ["farm", { id: "seen:hi", kind: "seen", sticker: "hi", date: yesterday }]]);
  await page.goto("/journal/check-in");
  const nook = page.locator(".farm-nook");
  await expect(nook).toHaveAttribute("data-host", /domino|bap/);
  const s = page.getByRole("region", { name: "Daily check-in" });
  const words = ["Pretend: a teapot and a cloud", "Pretend: a made-up friend", "Pretend: a warm bath"];
  for (let i = 0; i < 3; i++) {
    await expect(s.getByRole("img", { name: `Question ${i + 1} of 3` })).toBeVisible();
    const box = s.getByLabel("Your answer");
    await box.click();
    await box.pressSequentially(words[i]!, { delay: 20 });
    await expect(box).toBeFocused();
    await expect(box).toHaveValue(words[i]!);
    await s.getByRole("button", { name: i === 2 ? "Finish" : "Next →" }).click();
  }
  await expect(s.getByText("Checked in for today")).toBeVisible();
  await page.waitForTimeout(3500); // past the farm's 2 s journal re-read
  expect(await seenIds(page)).not.toContain("seen:lilypad");
  await expect(nook).not.toHaveAttribute("data-pose", "happy");
  await expect(page.locator(".farm-nook-news")).toHaveText("");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await leave(page);
  await expect.poll(() => seenIds(page), { timeout: 5000 }).toContain("seen:lilypad");
  // And the check-in is still there, saved.
  await page.goto("/journal/check-in");
  await expect(page.getByRole("region", { name: "Daily check-in" }).getByLabel("Your answer")).toHaveText(words);
  if (missingArt) {
    await page.goto("/farm");
    await expect(page.getByRole("heading", { level: 1, name: "Esme's Farm" })).toBeVisible();
    expect(refused).toBeGreaterThan(0); // the art really was missing
  }
});
