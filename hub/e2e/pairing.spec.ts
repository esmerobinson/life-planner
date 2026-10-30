import { expect, test, type Page } from "@playwright/test";
import encodeQR from "qr";

/* Pair a device by QR code, in a real browser. The sync server is a fake answered by
   page.route (https://sync.example.test never resolves); the passphrase is fictional. The
   "phone" camera is a canvas stream showing the pairing code, so the real frame reader and
   decoder run. Set SHOTS_DIR to save screenshots. */

const SERVER = "https://sync.example.test";
const PASS = "fake-pairing-passphrase-e2e-only-91b2";
const CODE = `esmeworld-pair:v1:${PASS}`;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "Authorization, Content-Type" };

async function fakeServer(page: Page) {
  const asked: string[] = [];
  await page.route(`${SERVER}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    asked.push(url.pathname);
    if (url.pathname === "/v1/sync") {
      return route.fulfill({ status: 200, headers: CORS, json: { cursor: 0, applied: 0, ignored: 0, hasMore: false, changes: [] } });
    }
    return route.fulfill({ status: 404, headers: CORS, json: { error: "not_found" } });
  });
  return asked;
}

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
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

async function saveOnSyncPage(page: Page) {
  await page.goto("/sync");
  await page.getByLabel("Sync address").fill(SERVER);
  await page.getByLabel("Passphrase", { exact: true }).fill(PASS);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
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

test("Sync page: after Save, Pair another device shows the pairing code; Hide and leaving hide it", async ({ page }) => {
  const asked = await fakeServer(page);
  await saveOnSyncPage(page);
  await expect.poll(() => asked.includes("/v1/sync")).toBe(true);
  await page.getByRole("button", { name: "Pair another device" }).click();
  const qr = page.getByRole("img", { name: "Pairing code" });
  await expect(qr).toBeVisible();
  const box = await qr.boundingBox();
  expect(box?.width).toBe(240);
  expect(box?.height).toBe(240);
  await expect(page.getByText("Anyone who scans this can open your Esmeworld. Only show it to your own devices.")).toBeVisible();
  expect(await decodeShownCode(page)).toBe(CODE);
  expect(await page.content()).not.toContain(PASS);
  expect(await everythingKept(page)).not.toContain(PASS);
  await shoot(page, "pairing-desktop-code");

  await expect(page.getByText(/^Hides in [01]:\d\d$/)).toBeVisible();

  // Hidden means forgotten: showing it again needs the passphrase pasted.
  const showAgain = async () => {
    await expect(page.getByRole("button", { name: "Pair another device" })).toHaveCount(0);
    await page.getByLabel("Passphrase for the pairing code").fill(PASS);
    await page.getByRole("button", { name: "Show pairing code" }).click();
    await expect(qr).toBeVisible();
  };
  await page.getByRole("button", { name: "Hide" }).click();
  await expect(qr).toHaveCount(0);
  await showAgain();
  // The Mac app losing focus hides it too.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(qr).toHaveCount(0);
  await showAgain();
  // Leaving the page: gone, and not offered again without the passphrase.
  await page.getByRole("link", { name: "Backup" }).first().click();
  await page.getByRole("link", { name: "Sync", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Pair a device" })).toBeVisible();
  await expect(qr).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pair another device" })).toHaveCount(0);
  await expect(page.getByLabel("Passphrase for the pairing code")).toBeVisible();
  expect(await everythingKept(page)).not.toContain(PASS);
});

test.describe("phone at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 }, permissions: ["camera"] });

  test("Scan pairing code: the camera reads the code and sets up sync with no typing", async ({ page }) => {
    const modules = encodeQR(CODE, "raw", { ecc: "medium", border: 4 });
    // A pretend rear camera filmed pointing at the Mac's code.
    await page.addInitScript((m: boolean[][]) => {
      const asked: unknown[] = [];
      (window as unknown as { cameraAsks: unknown[] }).cameraAsks = asked;
      const stopped: boolean[] = [];
      (window as unknown as { cameraStopped: boolean[] }).cameraStopped = stopped;
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async (constraints: unknown) => {
            asked.push(constraints);
            const c = document.createElement("canvas");
            c.width = 640;
            c.height = 480;
            const ctx = c.getContext("2d")!;
            const draw = () => {
              ctx.fillStyle = "#808080";
              ctx.fillRect(0, 0, 640, 480);
              const px = Math.floor(400 / m.length);
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(120, 40, m.length * px, m.length * px);
              ctx.fillStyle = "#000000";
              m.forEach((row, y) => row.forEach((dark, x) => dark && ctx.fillRect(120 + x * px, 40 + y * px, px, px)));
            };
            draw();
            const timer = setInterval(draw, 100);
            const stream = c.captureStream(10);
            for (const t of stream.getTracks()) {
              const stop = t.stop.bind(t);
              t.stop = () => {
                stopped.push(true);
                clearInterval(timer);
                stop();
              };
            }
            return stream;
          },
        },
      });
    }, modules);
    const asked = await fakeServer(page);
    await page.goto("/sync");
    await expect(page.getByLabel("Sync address")).not.toHaveValue("");
    await page.getByLabel("Sync address").fill(SERVER);
    await page.getByRole("button", { name: "Scan pairing code" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => (window as unknown as { cameraAsks: unknown[] }).cameraAsks)).toEqual([
      { video: { facingMode: "environment" }, audio: false },
    ]);
    expect(await page.evaluate(() => (window as unknown as { cameraStopped: boolean[] }).cameraStopped.length)).toBeGreaterThan(0);
    await expect(page.getByLabel("Camera")).toHaveCount(0);
    await expect.poll(() => asked.includes("/v1/sync")).toBe(true);
    expect(await everythingKept(page)).not.toContain(PASS);
    // The phone can now show the code on to another device; it fits the phone.
    await page.getByRole("button", { name: "Pair another device" }).click();
    await expect(page.getByRole("img", { name: "Pairing code" })).toBeVisible();
    const m = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
    await shoot(page, "pairing-phone-390-code");
  });
});

for (const width of [360, 430]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });
    test("the Sync page with the pairing code open does not scroll sideways", async ({ page }) => {
      await fakeServer(page);
      await saveOnSyncPage(page);
      await page.getByRole("button", { name: "Pair another device" }).click();
      await expect(page.getByRole("img", { name: "Pairing code" })).toBeVisible();
      const m = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
      expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
    });
  });
}
