import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { decodeQR } from "qr/decode.js";
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

type Row = { id: string; title: string; status: string; updatedAt?: number; [field: string]: unknown };

/** Reads one object store of this device's database directly. */
function readStore(page: Page, store: "items" | "goals" | "pending" | "prefs"): Promise<Row[]> {
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
  await page.getByLabel("Passphrase", { exact: true }).fill(E2E_PASSPHRASE);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Last synced /)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Passphrase", { exact: true })).toHaveValue("");
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

/* Due reminders (2026-11-16), after the test above (they share one server): the Due settings row
   and a to-do's time reach the server and another device, and the cron handler runs without a
   token and reaches nothing. */
test("Due settings and a to-do's time sync through the real server; the cron runs without a token and does nothing", async ({ browser, request }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await setUpSync(a);
  await a.goto("/reminders");
  const due = a.getByRole("region", { name: "Reminders in Due" });
  await due.getByRole("button", { name: "Reminders in Due: Off" }).click();
  await due.getByLabel("New motivation line").fill("A pretend line for the nudge");
  await due.getByRole("button", { name: "Add line" }).click();
  await expect.poll(async () => (await readStore(a, "prefs"))[0]?.lines).toEqual(["A pretend line for the nudge"]);

  await a.goto("/area/admin");
  await a.getByRole("button", { name: "To-dos", exact: true }).click();
  await a.getByRole("button", { name: "Add", exact: true }).click();
  // The + opens the one-box quick add (2026-11-17); the full form, with Due and Time, is More options.
  await a.getByRole("button", { name: "More options" }).click();
  const form = a.locator("form.quick-add");
  await form.getByLabel("Title").fill("Pretend appointment");
  await form.getByLabel("Due").fill("2026-12-01");
  await form.getByLabel("Time").fill("09:30");
  await form.getByRole("button", { name: "Add item" }).click();
  await expect(a.getByText("9:30am")).toBeVisible();
  await syncNow(a);

  await setUpSync(b);
  await syncNow(b);
  expect((await readStore(b, "prefs"))[0]).toMatchObject({ id: "due", on: true, lines: ["A pretend line for the nudge"] });
  expect((await readStore(b, "items")).find((i) => i.title === "Pretend appointment")).toMatchObject({ due: "2026-12-01", time: "09:30" });

  // The cron handler: no DUE_TOKEN here, so it runs and does nothing (no crash, nothing reached).
  const cron = await request.get(`${SYNC_URL}/__scheduled?cron=*/15+*+*+*+*`);
  expect(cron.status()).toBe(200);

  await ctxA.close();
  await ctxB.close();
});

/* Pair without the passphrase (2026-11-17), through the real server: A sets up by typing and
   writes a note to herself; on a later, fresh visit to the Sync page (nothing typed) A shows a
   code; B pastes it, syncs, reads A's note and writes one A reads. The production build has no
   /src modules, so the code on screen is read back from its SVG here in the test. */

/** The code on screen: the SVG's squares turned back into pixels and decoded. */
async function shownCode(page: Page): Promise<string> {
  const svg = page.locator("svg.pairing-qr");
  const n = Number((await svg.getAttribute("viewBox"))!.split(" ")[2]);
  const d = (await svg.locator("path").getAttribute("d"))!;
  const px = 6;
  const width = n * px;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const m of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    for (let dy = 0; dy < px; dy++)
      for (let dx = 0; dx < px; dx++) {
        const i = ((y * px + dy) * width + x * px + dx) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
  }
  return decodeQR({ width, height: width, data });
}

/** Opens Notes to myself, unlocking with the passphrase if Save's journal step was cut short by leaving the page. */
async function openNotes(page: Page) {
  await page.goto("/journal/notes");
  const unlock = page.getByRole("heading", { name: "Unlock journal" });
  const notes = page.getByRole("region", { name: "Notes to myself" });
  await expect(unlock.or(notes.getByRole("button", { name: "+ My own thought" }))).toBeVisible({ timeout: 30_000 });
  if (await unlock.isVisible()) {
    await page.getByLabel("Sync passphrase").fill(E2E_PASSPHRASE);
    await page.getByRole("button", { name: "Unlock" }).click();
  }
  return notes;
}

async function addNote(page: Page, worry: string, steady: string) {
  const notes = await openNotes(page);
  await notes.getByRole("button", { name: "+ My own thought" }).click({ timeout: 30_000 });
  const form = notes.getByRole("form", { name: "Your note" });
  await form.getByLabel("When I think…").fill(worry);
  await form.getByLabel("What I know when I'm steady…").fill(steady);
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toHaveCount(0);
}

test("pairing with no passphrase: a code from a fresh Sync page sets up another device, journal included", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await setUpSync(a);
  await addNote(a, "Pretend worry on device A", "Pretend steady words from device A.");
  await syncNow(a);

  await a.goto("/");
  await a.goto("/sync");
  await a.getByRole("button", { name: "Pair another device" }).click();
  await expect(a.getByRole("img", { name: "Pairing code" })).toBeVisible();
  const code = await shownCode(a);
  expect(code).toMatch(/^esmeworld-pair:v2:[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}\.http:\/\/127\.0\.0\.1:\d+#$/);
  expect(code).not.toContain(E2E_PASSPHRASE);
  await a.getByRole("button", { name: "Hide" }).click();

  await b.goto("/sync");
  // A production build takes a plain-http address from a code only when she typed it herself
  // (review M3), and a new device asks before using an address other than the usual one (C1).
  await b.getByLabel("Sync address").fill(SYNC_URL);
  await b.getByLabel("Paste pairing code").fill(code);
  await b.getByRole("button", { name: "Use pairing code" }).click();
  const ask = b.getByRole("group", { name: "Sync address in the code" });
  await expect(ask).toContainText(SYNC_URL);
  await ask.getByRole("button", { name: "Use this address" }).click();
  await expect(b.getByText(/^Last synced /)).toBeVisible({ timeout: 30_000 });
  await expect(b.getByLabel("Sync address")).toHaveValue(SYNC_URL);
  const notesB = b.getByRole("region", { name: "Notes to myself" });
  await b.goto("/journal/notes");
  await expect(notesB.getByText("Pretend steady words from device A.").first()).toBeVisible({ timeout: 30_000 });
  await expect(b.getByRole("heading", { name: "Unlock journal" })).toHaveCount(0);

  await addNote(b, "Pretend worry on device B", "Pretend steady words from device B.");
  await syncNow(b);
  await syncNow(a);
  await a.goto("/journal/notes");
  await expect(a.getByRole("region", { name: "Notes to myself" }).getByText("Pretend steady words from device B.").first()).toBeVisible({ timeout: 30_000 });

  await ctxA.close();
  await ctxB.close();
});

test("Today's routine: a step ticked on one device shows ticked on the other, through the real server", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await setUpSync(a);
  await setUpSync(b);

  await a.goto("/");
  const routineA = a.getByRole("region", { name: "Today's routine" });
  await routineA.getByRole("checkbox", { name: "Mark done: Up between 8 and 9am" }).click();
  await expect(routineA.getByText("1 of 10 today")).toBeVisible();
  // The count shows the tap at once; wait for the tick to be stored before syncing.
  const ticked = async () => (await readStore(a, "prefs")).some((r) => r.id.startsWith("routine-tick:") && r.step === "d1" && r.done === true);
  await expect.poll(ticked).toBe(true);
  await syncNow(a);

  await syncNow(b);
  await b.goto("/");
  const routineB = b.getByRole("region", { name: "Today's routine" });
  await expect(routineB.getByText("1 of 10 today")).toBeVisible();
  await routineB.getByText("Done (1)").click();
  await expect(routineB.getByRole("checkbox", { name: "Done: Up between 8 and 9am" })).toBeChecked();
  await expect(routineB.locator('[aria-current="step"]')).toContainText("5-minute meditation");

  await ctxA.close();
  await ctxB.close();
});

/* Today stops refilling (small fixes 3, 2026-11-18; fix round 1): the day's ONE shared picks row
   and a "Remove from today" reach the other device. The other device opens Home in a new app
   session BEFORE its first sync of the day has finished (the real morning path): it shows what
   last night's copy has and writes no picks of its own; when the sync lands it shows the day's
   first picks (the same row on both), without the removed one and with nothing pulled in.
   (The tests share one server, so the day's first picks may come from an earlier test's device.) */
test("Today: a phone that opens Home before its sync lands takes the Mac's picks; a removal on either is never replaced", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await setUpSync(a);

  // Six fictional to-dos (two priority 1), more than Today's four places, by a Merge import.
  const mine = [1, 2, 3, 4, 5, 6].map((k) => ({
    ...row(100 + k, `Pretend today job ${k}`), areaId: "writing", priority: k <= 2 ? 1 : 2,
  }));
  await a.goto("/backup");
  await a.getByLabel("Backup file").setInputFiles({
    name: "fictional-today.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ app: "life-hub", schema: 1, exportedOn: "2026-09-02", items: mine, goals: [] })),
  });
  await a.getByRole("button", { name: "Merge" }).click();
  await expect(a.getByText(/^Added 6 tasks/)).toBeVisible();
  await syncNow(a);
  // The phone joins and has everything (last night).
  await setUpSync(b);

  const list = (p: Page) => p.getByRole("list", { name: "Today", exact: true });
  const titles = async (p: Page) =>
    (await list(p).getByRole("checkbox").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""))).map((l) =>
      l.replace(/^Mark done: /, ""),
    );
  const kept = async (p: Page) => (await readStore(p, "prefs")).filter((r) => r.id.startsWith("today-fill:"));

  // This morning on the Mac: Home keeps its picks; she removes one.
  await a.goto("/");
  // The day's first picks may come from an earlier test's device on this shared server (the
  // pairing test opens Home too), so the counts are relative to what the Mac shows (R-M6).
  await expect.poll(async () => (await kept(a)).length).toBe(1);
  await expect.poll(async () => (await titles(a)).length).toBeGreaterThanOrEqual(2);
  const before = await titles(a);
  const n = before.length;
  await a.getByRole("button", { name: `Move to: ${before[0]}` }).click();
  await a.getByRole("button", { name: "Remove from today" }).click();
  await expect(list(a).getByRole("listitem")).toHaveCount(n - 1);
  await expect.poll(async () => (await readStore(a, "items")).find((r) => r.title === before[0])?.hiddenOn).toBeTruthy();
  await syncNow(a);

  // The phone opens fresh (a new app session) and its first sync is slow to land.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await ctxB.route("**/v1/sync", async (route) => {
    await held;
    await route.continue();
  });
  const keptBefore = await kept(b);
  await b.goto("/");
  // Last night's copy shows (the Mac's removal hasn't arrived; whether a row for today was
  // already here depends on earlier tests on this shared server, so no count here).
  await expect(list(b).getByRole("listitem").first()).toBeVisible();
  await b.waitForTimeout(500);
  // Nothing is kept from last night's copy: no picks written here, none waiting to send.
  expect(await kept(b)).toEqual(keptBefore);
  expect((await readStore(b, "pending")).filter((p) => String(p.id).startsWith("today-fill:"))).toEqual([]);
  release();
  // The sync lands: the Mac's list (the day's first picks, the same row on both), without the
  // removed one, nothing pulled in.
  await expect(list(b).getByRole("listitem")).toHaveCount(n - 1, { timeout: 30_000 });
  expect(await titles(b)).toEqual(before.slice(1));
  const [rowA] = await kept(a);
  const [rowB] = await kept(b);
  expect(rowB).toMatchObject({ id: rowA!.id, ids: rowA!.ids, pickedAt: rowA!.pickedAt });
  await ctxB.unroute("**/v1/sync");

  // The phone removes another; back on the Mac it's gone and nothing new comes in.
  await b.getByRole("button", { name: `Move to: ${before[1]}` }).click();
  await b.getByRole("button", { name: "Remove from today" }).click();
  await expect(list(b).getByRole("listitem")).toHaveCount(n - 2);
  await expect.poll(async () => (await readStore(b, "items")).find((r) => r.title === before[1])?.hiddenOn).toBeTruthy();
  await syncNow(b);
  await syncNow(a);
  await a.goto("/");
  await expect(list(a).getByRole("listitem")).toHaveCount(n - 2);
  expect(await titles(a)).toEqual(before.slice(2));

  await ctxA.close();
  await ctxB.close();
});
