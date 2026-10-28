import { expect, test, type Page } from "@playwright/test";

/* The Vision board in a real browser: the borderless collage (VISUAL-LANGUAGE.md "Vision
   board", mockup tab D) with fictional pins. Nothing here reaches Pinterest or a real sync
   server: both are answered by page.route. Set SHOTS_DIR to save screenshots. */

const SERVER = "https://sync.example.test";
const PIN_COUNT = 12;

/** Fictional pins; images are drawn locally (magenta/grey placeholders of varied heights). */
const pins = Array.from({ length: PIN_COUNT }, (_, i) => ({
  img: `https://i.pinimg.com/736x/fi/ct/fictional-${i + 1}.jpg`,
  link: `https://www.pinterest.com/pin/fictional-${i + 1}/`,
}));

function placeholderSvg(n: number): string {
  const height = 300 + ((n * 137) % 5) * 80;
  const fill = n % 2 ? "#ff00ff" : "#999999";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="736" height="${height}" viewBox="0 0 736 ${height}">
<rect width="736" height="${height}" fill="${fill}"/>
<text x="40" y="90" font-family="system-ui" font-size="56" fill="#000">fictional pin ${n}</text></svg>`;
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "Authorization, Content-Type" };

async function fakeNetwork(page: Page, opts: { boardStatus?: number } = {}) {
  const asked: string[] = [];
  await page.route(`${SERVER}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname === "/v1/pinterest-board") {
      const board = url.searchParams.get("board")!;
      asked.push(board);
      if (opts.boardStatus && opts.boardStatus !== 200) {
        return route.fulfill({ status: opts.boardStatus, headers: CORS, json: { error: "pinterest_unavailable" } });
      }
      return route.fulfill({ status: 200, headers: CORS, json: { board, fetchedAt: Date.now() - 5 * 60_000, pins } });
    }
    if (url.pathname === "/v1/sync") {
      return route.fulfill({ status: 200, headers: CORS, json: { cursor: 0, applied: 0, ignored: 0, hasMore: false, changes: [] } });
    }
    return route.fulfill({ status: 404, headers: CORS, json: { error: "not_found" } });
  });
  await page.route("https://i.pinimg.com/**", (route) => {
    const n = Number(/fictional-(\d+)/.exec(route.request().url())?.[1] ?? 0);
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: placeholderSvg(n) });
  });
  // Never let anything else leave the machine.
  await page.route(/^https:\/\/(www\.)?pinterest\.com\//, (route) => route.abort());
  return asked;
}

/** Stores a fake sync address and token, as the Sync page would. */
async function setUpSync(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  await page.evaluate(async (server) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open("life-hub");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(["syncMeta"], "readwrite");
      tx.objectStore("syncMeta").put({ key: "serverUrl", value: server });
      tx.objectStore("syncMeta").put({ key: "token", value: "f".repeat(64) });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, SERVER);
}

async function imagesLoaded(page: Page) {
  await expect
    .poll(() =>
      page.locator(".vision-collage img").evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0)),
    )
    .toBe(true);
}

/** Each photo's box, rounded to whole pixels. */
async function boxes(page: Page) {
  return page.locator(".vision-collage img").evaluateAll((imgs) =>
    imgs.map((i) => {
      const r = i.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
    }),
  );
}

type Box = Awaited<ReturnType<typeof boxes>>[number];

/** Columns touch side to side, and photos in a column touch top to bottom. */
function expectEdgeToEdge(all: Box[], columns: number) {
  const lefts = [...new Set(all.map((b) => b.left))].sort((a, b) => a - b);
  expect(lefts).toHaveLength(columns);
  for (let c = 1; c < lefts.length; c++) {
    const prevRight = all.find((b) => b.left === lefts[c - 1])!.right;
    expect(Math.abs(prevRight - lefts[c]!)).toBeLessThanOrEqual(1);
  }
  for (const left of lefts) {
    const column = all.filter((b) => b.left === left).sort((a, b) => a.top - b.top);
    for (let i = 1; i < column.length; i++) expect(Math.abs(column[i]!.top - column[i - 1]!.bottom)).toBeLessThanOrEqual(1);
  }
}

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

test.describe("desktop 1280", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("shows the board as 4 edge-to-edge columns of photos that open the pin", async ({ page }) => {
    const asked = await fakeNetwork(page);
    await setUpSync(page);
    await page.goto("/vision");
    await expect(page.getByText(`from Pinterest · visionboardfuture · ${PIN_COUNT} pins · updated 5 min ago`)).toBeVisible();
    expect(asked).toEqual(["esmelrobinson/visionboardfuture"]);
    const links = page.getByRole("link", { name: "Open pin on Pinterest" });
    await expect(links).toHaveCount(PIN_COUNT);
    await expect(links.first()).toHaveAttribute("target", "_blank");
    await expect(links.first()).toHaveAttribute("rel", "noopener noreferrer");
    await expect(links.first()).toHaveAttribute("href", pins[0]!.link);
    await imagesLoaded(page);
    const style = await page.locator(".vision-collage img").first().evaluate((el) => {
      const s = getComputedStyle(el);
      const a = getComputedStyle(el.parentElement!);
      return [s.borderTopWidth, s.borderRadius, s.boxShadow, a.borderTopWidth, a.borderRadius, a.boxShadow];
    });
    expect(style).toEqual(["0px", "0px", "none", "0px", "0px", "none"]);
    expectEdgeToEdge(await boxes(page), 4);
    await shoot(page, "vision-1280");
  });

  test("Refresh asks again; the stored board shows on the next visit without asking", async ({ page }) => {
    const asked = await fakeNetwork(page);
    await setUpSync(page);
    await page.goto("/vision");
    await expect(page.getByRole("link", { name: "Open pin on Pinterest" })).toHaveCount(PIN_COUNT);
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect.poll(() => asked.length).toBe(2);
    await page.goto("/today");
    await page.goto("/vision");
    await expect(page.getByRole("link", { name: "Open pin on Pinterest" })).toHaveCount(PIN_COUNT);
    expect(asked).toHaveLength(2);
  });

  test("says so calmly when Pinterest does not answer", async ({ page }) => {
    await fakeNetwork(page, { boardStatus: 502 });
    await setUpSync(page);
    await page.goto("/vision");
    await expect(page.getByText(/Pinterest did not answer just now/)).toBeVisible();
  });

  test("points to Sync when sync is not set up", async ({ page }) => {
    const asked = await fakeNetwork(page);
    await page.goto("/vision");
    await expect(page.getByText(/Set up Sync on this device/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Sync", exact: true }).last()).toHaveAttribute("href", "/sync");
    expect(asked).toEqual([]);
  });
});

test.describe("phone 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows 2 edge-to-edge columns and never scrolls sideways", async ({ page }) => {
    await fakeNetwork(page);
    await setUpSync(page);
    await page.goto("/vision");
    await expect(page.locator(".phone-top")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open pin on Pinterest" })).toHaveCount(PIN_COUNT);
    await imagesLoaded(page);
    expectEdgeToEdge(await boxes(page), 2);
    await page.getByText("Change board").click();
    const m = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
    await page.getByText("Change board").click();
    await shoot(page, "vision-390");
  });
});

// The production build (what the Mac app bundles and Pages serves): no CSP or service worker
// rule stops photos from i.pinimg.com loading.
test.describe("production build", () => {
  test.use({ baseURL: `http://127.0.0.1:${process.env.E2E_PREVIEW_PORT ?? 4173}`, viewport: { width: 1280, height: 900 } });

  test("loads the photos", async ({ page }) => {
    await fakeNetwork(page);
    await setUpSync(page);
    await page.goto("/vision");
    await expect(page.getByRole("link", { name: "Open pin on Pinterest" })).toHaveCount(PIN_COUNT);
    await imagesLoaded(page);
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').count();
    expect(csp).toBe(0);
  });
});
