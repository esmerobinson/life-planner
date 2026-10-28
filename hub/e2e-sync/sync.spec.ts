import { expect, test, type BrowserContext, type Page } from "@playwright/test";
// The same throwaway values as e2e-sync/server.mjs (obviously fake, local server only).
const E2E_PASSPHRASE = "e2e-fake-passphrase-not-real-0000";
const E2E_SYNC_PORT = Number(process.env.E2E_SYNC_PORT ?? 8790);

// Two (then three) separate browser contexts = separate devices, each with its own
// IndexedDB, all syncing through the REAL server code running locally (wrangler dev).
// Every name and task here is fictional.

const SYNC_URL = `http://127.0.0.1:${E2E_SYNC_PORT}`;
const AREA = "art";
const row = (n: number, title: string) => ({
  id: `e2e-item-${n}`, kind: "task", title, links: [], areaId: AREA, priority: 2, status: "open",
  createdAt: "2026-09-01", touchedAt: "2026-09-01",
});
const FILE_ITEMS = [
  row(1, "Water the fictional ferns"),
  row(2, "Sketch an imaginary lighthouse"),
  row(3, "Label the pretend paint tubes"),
  row(4, "Frame the made-up postcard"),
  row(5, "Sort the fictional brushes"),
];
const BACKUP = {
  app: "life-hub", schema: 1, exportedOn: "2026-09-02",
  items: FILE_ITEMS,
  goals: [{ id: "e2e-goal-1", title: "Paint a pretend mural", areaId: AREA, kind: "practice", milestones: [], createdAt: "2026-09-01" }],
};

type Row = { id: string; title: string; status: string; updatedAt?: number };

/** Reads one object store of this device's database directly. */
function readStore(page: Page, store: "items" | "goals" | "pending"): Promise<Row[]> {
  return page.evaluate(
    (name) =>
      new Promise<Row[]>((resolve, reject) => {
        const req = indexedDB.open("life-hub");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const idb = req.result;
          const get = idb.transaction(name, "readonly").objectStore(name).getAll();
          get.onsuccess = () => {
            resolve(get.result as Row[]);
            idb.close();
          };
          get.onerror = () => reject(get.error);
        };
      }),
    store,
  );
}

const summary = async (page: Page) =>
  (await readStore(page, "items")).map((r) => `${r.id}|${r.title}|${r.status}`).sort();

async function setUpSync(page: Page) {
  await page.goto("/sync");
  await page.getByLabel("Sync address").fill(SYNC_URL);
  await page.getByLabel("Passphrase").fill(E2E_PASSPHRASE);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Last synced /)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Passphrase")).toHaveValue("");
}

/** Presses Sync now and waits until this device has nothing left to send. */
async function syncNow(page: Page) {
  if (!page.url().endsWith("/sync")) await page.goto("/sync");
  const button = page.getByRole("button", { name: "Sync now" });
  await expect(button).toBeEnabled({ timeout: 30_000 });
  const answered = page.waitForResponse((r) => r.url().endsWith("/v1/sync") && r.request().method() === "POST");
  await button.click();
  await answered;
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await expect.poll(async () => (await readStore(page, "pending")).length, { timeout: 30_000 }).toBe(0);
}

async function device(context: BrowserContext) {
  const page = await context.newPage();
  return page;
}

test("two devices converge through the real server: import, own items, edits, a stale upgraded device, two tabs", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await device(ctxA);
  const b = await device(ctxB);

  // Device A joins sync, then imports a small fictional backup with Merge and syncs it.
  await setUpSync(a);
  await a.goto("/backup");
  await a.getByLabel("Backup file").setInputFiles({
    name: "fictional-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(BACKUP)),
  });
  await a.getByRole("button", { name: "Merge" }).click();
  await expect(a.getByText("Added 5 tasks and 1 goal. 0 already here.")).toBeVisible();
  await syncNow(a);

  // Device B has a few items of its own, then joins.
  await b.goto("/inbox");
  const box = b.getByRole("textbox", { name: "Add to inbox" });
  for (const t of ["Phone the pretend framer", "Buy imaginary canvas"]) {
    await box.fill(t);
    await box.press("Enter");
  }
  await expect.poll(async () => (await readStore(b, "items")).length).toBe(2); // both saved before leaving the page
  await setUpSync(b);
  await expect.poll(async () => (await readStore(b, "items")).length, { timeout: 30_000 }).toBe(7);
  await syncNow(b);
  await syncNow(a);

  // Both hold the same 7 tasks and 1 goal, with no duplicates.
  expect(await summary(a)).toEqual(await summary(b));
  const titles = (await readStore(a, "items")).map((r) => r.title);
  expect(new Set(titles).size).toBe(7);
  expect((await readStore(a, "goals")).map((g) => g.id)).toEqual(["e2e-goal-1"]);
  expect((await readStore(b, "goals")).map((g) => g.id)).toEqual(["e2e-goal-1"]);

  // An edit on B after A's import reaches A.
  await b.goto(`/area/${AREA}`);
  await b.getByRole("checkbox", { name: "Mark done: Water the fictional ferns" }).click();
  await expect.poll(async () => (await readStore(b, "items")).find((r) => r.id === "e2e-item-1")?.status).toBe("done");
  await syncNow(b);
  await syncNow(a);
  expect((await readStore(a, "items")).find((r) => r.id === "e2e-item-1")?.status).toBe("done");

  // Device C still has a pre-sync (v1) database holding an OLD copy of that task. It upgrades
  // now and joins: its stale copy must not overwrite the newer edit anywhere.
  await ctxC.addInitScript((stale) => {
    if (sessionStorage.getItem("seeded-v1")) return;
    sessionStorage.setItem("seeded-v1", "1");
    const req = indexedDB.open("life-hub", 10); // Dexie version 1
    req.onupgradeneeded = () => {
      const idb = req.result;
      const items = idb.createObjectStore("items", { keyPath: "id" });
      for (const index of ["status", "areaId", "goalId", "due"]) items.createIndex(index, index);
      idb.createObjectStore("goals", { keyPath: "id" });
      items.put(stale);
    };
    req.onsuccess = () => req.result.close();
  }, { ...FILE_ITEMS[0], title: "Water the fictional ferns (old copy)", touchedAt: "2026-09-01" });
  const c = await device(ctxC);
  await c.goto(`/area/${AREA}`);
  await expect(c.getByText("Water the fictional ferns (old copy)")).toBeVisible();
  await setUpSync(c);
  await expect
    .poll(async () => (await readStore(c, "items")).find((r) => r.id === "e2e-item-1")?.status, { timeout: 30_000 })
    .toBe("done");
  await syncNow(c);
  await syncNow(a);
  await syncNow(b);
  const ferns = (p: Page) => readStore(p, "items").then((rows) => rows.find((r) => r.id === "e2e-item-1"));
  for (const p of [a, b, c]) {
    expect(await ferns(p)).toMatchObject({ title: "Water the fictional ferns", status: "done" });
  }
  expect(await summary(c)).toEqual(await summary(a));

  // Two tabs of one device never sync at the same time (Web Locks), even when both are asked.
  let inFlight = 0;
  let most = 0;
  let total = 0;
  await ctxA.route("**/v1/sync", async (route) => {
    inFlight++;
    total++;
    most = Math.max(most, inFlight);
    const response = await route.fetch();
    await new Promise((r) => setTimeout(r, 300));
    inFlight--;
    await route.fulfill({ response });
  });
  const a2 = await ctxA.newPage();
  await a2.goto("/sync");
  await a.goto("/sync");
  const buttons = [a, a2].map((p) => p.getByRole("button", { name: "Sync now" }));
  for (const btn of buttons) await expect(btn).toBeEnabled({ timeout: 30_000 });
  await Promise.all(buttons.map((btn) => btn.click()));
  for (const btn of buttons) await expect(btn).toBeEnabled({ timeout: 30_000 });
  await a.waitForTimeout(1000);
  expect(total).toBeGreaterThanOrEqual(2); // both tabs did sync...
  expect(most).toBe(1); // ...one at a time

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
