import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import encodeQR from "qr";
import { FakeSyncServer } from "../src/sync/fakeServer";
import { deriveToken } from "../src/sync/token";

/* Pair a device without the passphrase (2026-11-17), in real browsers. Two browser contexts are
   two devices with their own IndexedDB, syncing through ONE in-memory stand-in for the sync
   server (the hub's FakeSyncServer, answering page.route for https://sync.example.test). The
   "Mac" shows its code on a fresh visit to the Sync page with nothing typed; the "phone" scans
   it with a pretend camera filming that code, or pastes it. Passphrases and notes are fictional.
   Set SHOTS_DIR to save screenshots. */

const ADDRESS = "https://sync.example.test";
const PASS = "fake-pair-v2-e2e-passphrase-7d3e";
const NEW_PASS = "fake-pair-v2-e2e-new-passphrase-9a1c";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, GET, OPTIONS",
};

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

/** Every request this context makes to the sync address goes to `server`. */
async function useServer(context: BrowserContext, server: FakeSyncServer) {
  await context.route(`${ADDRESS}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const res = await server.fetch(req.url(), { method: req.method(), headers: req.headers(), body: req.postData() ?? undefined });
    return route.fulfill({ status: res.status, headers: { ...CORS, "content-type": "application/json" }, body: await res.text() });
  });
}

async function device(browser: Browser, server: FakeSyncServer, phone = false) {
  const context = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, permissions: ["camera"] } : {});
  await useServer(context, server);
  return { context, page: await context.newPage() };
}

/** Sync page Save with the passphrase typed (how the first device is set up). */
async function setUpByTyping(page: Page, passphrase = PASS) {
  await page.goto("/sync");
  await page.getByLabel("Sync address").fill(ADDRESS);
  await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/^Last synced /)).toBeVisible({ timeout: 30_000 });
  // Save's journal step (three key derivations) finishes on this page before anything navigates.
  await expect
    .poll(() => page.evaluate(async () => {
      const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
      const { db } = await at("/src/data/db.ts");
      const keys = await at("/src/journal/keyStore.ts");
      return (await keys.confirmJournalKey(db)) === "confirmed" && !(await keys.loadCandidate(db));
    }), { timeout: 30_000 })
    .toBe(true);
}

/** Sync now, and wait until nothing is left to send. */
async function syncNow(page: Page) {
  if (!page.url().endsWith("/sync")) await page.goto("/sync");
  const button = page.getByRole("button", { name: "Sync now" });
  await expect(button).toBeEnabled({ timeout: 30_000 });
  const answered = page.waitForResponse((r) => r.url().endsWith("/v1/sync") && r.request().method() === "POST");
  await button.click();
  await answered;
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(async () => {
      const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
      const { db } = await at("/src/data/db.ts");
      return db.pending.count();
    }), { timeout: 30_000 })
    .toBe(0);
}

/** Writes a note of her own on Notes to myself (journal must be open). */
async function writeNote(page: Page, worry: string, steady: string) {
  await page.goto("/journal/notes");
  const s = page.getByRole("region", { name: "Notes to myself" });
  await s.getByRole("button", { name: "+ My own thought" }).click({ timeout: 30_000 });
  const form = s.getByRole("form", { name: "Your note" });
  await form.getByLabel("When I think…").fill(worry);
  await form.getByLabel("What I know when I'm steady…").fill(steady);
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toHaveCount(0); // saved and closed: the note's row is written
  await expect(s.getByText(steady).first()).toBeVisible();
}

async function seesNote(page: Page, steady: string) {
  await syncNow(page);
  await page.goto("/journal/notes");
  await expect(page.getByRole("region", { name: "Notes to myself" }).getByText(steady).first()).toBeVisible({ timeout: 30_000 });
}

/** The SVG on screen, drawn to a canvas and read with the app's own decoder. */
async function decodeShownCode(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const svg = document.querySelector<SVGSVGElement>("svg.pairing-qr")!;
    const markup = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 480;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, 480, 480);
    const { loadDecoder } = await import(/* @vite-ignore */ `${location.origin}/src/pairing/qr.ts`);
    const decode = await loadDecoder();
    return decode({ width: 480, height: 480, data: ctx.getImageData(0, 0, 480, 480).data });
  });
}

/** Everything in IndexedDB, localStorage and sessionStorage, plus the URL and history, as text. */
async function everythingKept(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const out: string[] = [location.href, JSON.stringify(history.state)];
    for (const info of await indexedDB.databases()) {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open(info.name!);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const all: unknown[] = await new Promise((res, rej) => {
          const r = db.transaction(store, "readonly").objectStore(store).getAll();
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        out.push(JSON.stringify(all, (_k, v) => (v instanceof CryptoKey ? "[key]" : v)));
      }
      db.close();
    }
    for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) out.push(s.key(i)!, s.getItem(s.key(i)!) ?? "");
    return out.join("\n");
  });
}

/** A fresh visit to the Sync page, nothing typed: "Pair another device" and the code it shows. */
async function showCodeWithoutTyping(page: Page): Promise<string> {
  await page.goto("/");
  await page.goto("/sync");
  await page.getByRole("button", { name: "Pair another device" }).click();
  await expect(page.getByRole("img", { name: "Pairing code" })).toBeVisible();
  return decodeShownCode(page);
}

/** A pretend rear camera filming `text` as a QR code (installed before the page loads). */
async function cameraFilming(page: Page, text: string) {
  const modules = encodeQR(text, "raw", { ecc: "medium", border: 4 });
  await page.addInitScript((m: boolean[][]) => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const c = document.createElement("canvas");
          c.width = 640;
          c.height = 480;
          const ctx = c.getContext("2d")!;
          const draw = () => {
            ctx.fillStyle = "#808080";
            ctx.fillRect(0, 0, 640, 480);
            const px = Math.floor(440 / m.length);
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(100, 20, m.length * px, m.length * px);
            ctx.fillStyle = "#000000";
            m.forEach((row, y) => row.forEach((dark, x) => dark && ctx.fillRect(100 + x * px, 20 + y * px, px, px)));
          };
          draw();
          const timer = setInterval(draw, 100);
          const stream = c.captureStream(10);
          for (const t of stream.getTracks()) {
            const stop = t.stop.bind(t);
            t.stop = () => {
              clearInterval(timer);
              stop();
            };
          }
          return stream;
        },
      },
    });
  }, modules);
}

const WORRY_A = "Pretend worry written on the Mac";
const STEADY_A = "Pretend steady words from the Mac, about a made-up lighthouse.";
const WORRY_B = "Pretend worry written on the phone";
const STEADY_B = "Pretend steady words from the phone, about a pretend fern.";

test("a fresh Sync page visit shows a code with no passphrase; the phone scans it, syncs, reads the Mac's journal and writes one back", async ({ browser }) => {
  test.setTimeout(180_000);
  const server = new FakeSyncServer(await deriveToken(PASS));
  const a = await device(browser, server);
  await setUpByTyping(a.page);
  await writeNote(a.page, WORRY_A, STEADY_A);
  await syncNow(a.page);

  // Later: a new visit, nothing typed. The code is there at a tap, carries no passphrase.
  const text = await showCodeWithoutTyping(a.page);
  expect(text.startsWith("esmeworld-pair:v2:")).toBe(true);
  expect(text).not.toContain(PASS);
  await expect(a.page.getByText("This code sets up sync only.", { exact: false })).toHaveCount(0);
  await expect(a.page.getByText(/^Hides in [01]:\d\d$/)).toBeVisible();
  expect(await a.page.content()).not.toContain(text.slice(18, 60));
  expect(await everythingKept(a.page)).not.toContain(text.slice(18));
  await shoot(a.page, "pair-v2-mac-code");
  await a.page.getByRole("button", { name: "Hide" }).click();
  await expect(a.page.getByRole("img", { name: "Pairing code" })).toHaveCount(0);

  // The phone: a new device, nothing typed anywhere. The Sync address is its own default.
  const b = await device(browser, server, true);
  await cameraFilming(b.page, text);
  await b.page.goto("/sync");
  await b.page.getByRole("button", { name: "Scan pairing code" }).click();
  await expect(b.page.getByText("Saved.")).toBeVisible({ timeout: 20_000 });
  await expect(b.page.getByLabel("Sync address")).toHaveValue(ADDRESS);
  await expect(b.page.getByText(/^Last synced /)).toBeVisible({ timeout: 30_000 });
  await seesNote(b.page, STEADY_A);
  await expect(b.page.getByRole("heading", { name: "Unlock journal" })).toHaveCount(0);
  expect(await everythingKept(b.page)).not.toContain(text.slice(18));
  await shoot(b.page, "pair-v2-phone-reads");

  await writeNote(b.page, WORRY_B, STEADY_B);
  await syncNow(b.page);
  await syncNow(a.page);
  await seesNote(a.page, STEADY_B);

  // The phone can pass a full code on, also without typing.
  const fromPhone = await showCodeWithoutTyping(b.page);
  expect(fromPhone.startsWith("esmeworld-pair:v2:")).toBe(true);
  await expect(b.page.getByText("This code sets up sync only.", { exact: false })).toHaveCount(0);

  // Stop syncing on the phone removes the sync token, as on a device set up by typing.
  await b.page.getByRole("button", { name: "Hide" }).click();
  await b.page.getByRole("button", { name: "Stop syncing on this device" }).click();
  await expect(b.page.getByText("Sync is off on this device.")).toBeVisible();
  const token = await b.page.evaluate(async () => {
    const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
    const { db } = await at("/src/data/db.ts");
    return (await db.syncMeta.get("token"))?.value ?? null;
  });
  expect(token).toBeNull();
  await expect(b.page.getByRole("button", { name: "Pair another device" })).toHaveCount(0);
  await a.context.close();
  await b.context.close();
});

test("v1 codes still work both ways: a new phone reads an older Mac's code; a new Mac still shows one for an older phone", async ({ browser }) => {
  test.setTimeout(180_000);
  const server = new FakeSyncServer(await deriveToken(PASS));
  const a = await device(browser, server);
  await setUpByTyping(a.page);
  await writeNote(a.page, WORRY_A, STEADY_A);
  await syncNow(a.page);

  // An older Mac's code is the passphrase itself; a new phone pastes it.
  const b = await device(browser, server, true);
  await b.page.goto("/sync");
  await b.page.getByLabel("Sync address").fill(ADDRESS);
  await b.page.getByLabel("Paste pairing code").fill(`esmeworld-pair:v1:${PASS}`);
  await b.page.getByRole("button", { name: "Use pairing code" }).click();
  await expect(b.page.getByText(/^Last synced /)).toBeVisible({ timeout: 30_000 });
  await seesNote(b.page, STEADY_A);

  // An older phone reads only v1: the new Mac still makes one from the typed passphrase.
  await a.page.goto("/sync");
  await a.page.getByLabel("Passphrase for the pairing code").fill(PASS);
  await a.page.getByRole("button", { name: "Show pairing code" }).click();
  await expect(a.page.getByRole("img", { name: "Pairing code" })).toBeVisible();
  expect(await decodeShownCode(a.page)).toBe(`esmeworld-pair:v1:${PASS}`);
  await a.context.close();
  await b.context.close();
});

test("a device whose passphrase was refused offers no code at all", async ({ browser }) => {
  test.setTimeout(120_000);
  const server = new FakeSyncServer(await deriveToken(PASS));
  const a = await device(browser, server);
  await setUpByTyping(a.page);
  (server as unknown as { token: string }).token = await deriveToken(NEW_PASS); // the passphrase changed elsewhere
  await a.page.getByRole("button", { name: "Sync now" }).click();
  await expect(a.page.getByText("The passphrase was not accepted. Enter it again to keep syncing.")).toBeVisible({ timeout: 30_000 });
  await expect(a.page.getByRole("button", { name: "Pair another device" })).toHaveCount(0);
  await expect(a.page.getByLabel("Passphrase for the pairing code")).toHaveCount(0);
  await a.page.goto("/");
  await a.page.goto("/sync");
  await expect(a.page.getByRole("heading", { name: "Pair a device" })).toBeVisible();
  await expect(a.page.getByText("The passphrase was not accepted. Enter it again to keep syncing.")).toBeVisible();
  await expect(a.page.getByRole("button", { name: "Pair another device" })).toHaveCount(0);
  await a.context.close();
});

test("a journal set up before the re-key update: the code sets up sync only and says so; the passphrase typed once then brings the journal along", async ({ browser }) => {
  test.setTimeout(180_000);
  const server = new FakeSyncServer(await deriveToken(PASS));
  const a = await device(browser, server);
  await setUpByTyping(a.page);
  await writeNote(a.page, WORRY_A, STEADY_A);
  await syncNow(a.page);
  // As if the Mac's journal key had been stored by a build before the re-key update: key only.
  await a.page.evaluate(async () => {
    const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
    const { db } = await at("/src/data/db.ts");
    const k = (await db.syncMeta.get("journalKey")).value;
    const { s: _s, ...keyOnly } = k;
    await db.syncMeta.put({ key: "journalKey", value: keyOnly });
  });

  const syncOnly = await showCodeWithoutTyping(a.page);
  expect(syncOnly).toMatch(/^esmeworld-pair:v2:[A-Za-z0-9_-]{43}\.\./);
  await expect(a.page.getByText("This code sets up sync only.", { exact: false })).toBeVisible();
  await shoot(a.page, "pair-v2-mac-sync-only");

  // The phone syncs from it; its journal asks for the passphrase (nothing to open it with).
  const b = await device(browser, server, true);
  await b.page.goto("/sync");
  await b.page.getByLabel("Paste pairing code").fill(syncOnly);
  await b.page.getByRole("button", { name: "Use pairing code" }).click();
  await expect(b.page.getByText(/^Last synced /)).toBeVisible({ timeout: 30_000 });
  await b.page.goto("/journal/notes");
  await expect(b.page.getByRole("heading", { name: "Unlock journal" })).toBeVisible({ timeout: 30_000 });

  // On the Mac she types the passphrase once for a code: from then on its codes carry the journal.
  await a.page.getByRole("button", { name: "Hide" }).click();
  await a.page.getByLabel("Passphrase for the pairing code").fill(PASS);
  await a.page.getByRole("button", { name: "Show pairing code" }).click();
  await expect(a.page.getByRole("img", { name: "Pairing code" })).toBeVisible();
  expect(await decodeShownCode(a.page)).toBe(`esmeworld-pair:v1:${PASS}`);
  await a.page.getByRole("button", { name: "Hide" }).click();
  await expect
    .poll(() => a.page.evaluate(async () => {
      const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
      const { db } = await at("/src/data/db.ts");
      const keys = await at("/src/journal/keyStore.ts");
      const s = await keys.journalSecretForPairing(db);
      s?.fill(0);
      return !!s;
    }), { timeout: 20_000 })
    .toBe(true);
  const full = await showCodeWithoutTyping(a.page);
  expect(full).toMatch(/^esmeworld-pair:v2:[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}\./);
  await expect(a.page.getByText("This code sets up sync only.", { exact: false })).toHaveCount(0);

  // The phone's Unlock journal takes the full code.
  await b.page.getByLabel("Paste pairing code").fill(full);
  await b.page.getByRole("button", { name: "Use pairing code" }).click();
  await expect(b.page.getByRole("heading", { name: "Unlock journal" })).toHaveCount(0, { timeout: 30_000 });
  await seesNote(b.page, STEADY_A);
  await a.context.close();
  await b.context.close();
});

test("after a passphrase change, the Mac's code carries the new one; the paired phone later changes it again with no old-passphrase prompt", async ({ browser }) => {
  test.setTimeout(180_000);
  const NEWER = "fake-pair-v2-e2e-newer-passphrase-4b8f";
  const server = new FakeSyncServer(await deriveToken(PASS));
  const a = await device(browser, server);
  await setUpByTyping(a.page);
  await writeNote(a.page, WORRY_A, STEADY_A);
  await syncNow(a.page);
  (server as unknown as { token: string }).token = await deriveToken(NEW_PASS);
  await setUpByTyping(a.page, NEW_PASS);
  await expect(a.page.getByRole("region", { name: "Type your old passphrase once" })).toHaveCount(0);

  const text = await showCodeWithoutTyping(a.page);
  const b = await device(browser, server, true);
  await b.page.goto("/sync");
  await b.page.getByLabel("Paste pairing code").fill(text);
  await b.page.getByRole("button", { name: "Use pairing code" }).click();
  await expect(b.page.getByText(/^Last synced /)).toBeVisible({ timeout: 30_000 });
  await seesNote(b.page, STEADY_A);

  // The phone is where the next change is typed: nothing asks for an old passphrase.
  (server as unknown as { token: string }).token = await deriveToken(NEWER);
  await setUpByTyping(b.page, NEWER);
  await syncNow(b.page);
  await expect(b.page.getByRole("region", { name: "Type your old passphrase once" })).toHaveCount(0);
  await seesNote(b.page, STEADY_A);

  // A third device that types only the newest passphrase opens the journal (through the phone's wrap).
  const c = await device(browser, server);
  await setUpByTyping(c.page, NEWER);
  await seesNote(c.page, STEADY_A);
  for (const d of [a, b, c]) await d.context.close();
});
