// @vitest-environment node
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";

// These tests read the BUILT output. They run `npm run build` themselves so that
// `npx vitest run` is green from a clean checkout (the build takes a few seconds).
const root = resolve(__dirname, "..");
// A separate output directory: the test must never touch the shared dist/
// (a running preview or Playwright's build may be using it).
const dist = resolve(root, "dist-test");
const read = (f: string) => readFileSync(resolve(dist, f), "utf8");

beforeAll(() => {
  execSync("npx vite build --outDir dist-test --emptyOutDir", { cwd: root, stdio: "pipe" });
}, 180_000);

describe("built manifest", () => {
  it("has the install fields and no invented colours", () => {
    const m = JSON.parse(read("manifest.webmanifest"));
    expect(m.name).toBe("Esmeworld");
    expect(m.short_name).toBe("Esmeworld");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m).not.toHaveProperty("theme_color");
    expect(m).not.toHaveProperty("background_color");
    const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    for (const i of m.icons) expect(existsSync(resolve(dist, i.src.replace(/^\//, "")))).toBe(true);
  });
});

/** Reads one pixel of an 8-bit RGB, non-interlaced PNG as "r,g,b" (decodes the scanline filters). */
function pixel(png: Buffer, px: number, py: number): string {
  expect(png[24]).toBe(8); // bit depth
  expect(png[25]).toBe(2); // colour type RGB
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  const idat: Buffer[] = [];
  for (let o = 8; o < png.length; ) {
    const len = png.readUInt32BE(o);
    if (png.subarray(o + 4, o + 8).toString("ascii") === "IDAT") idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 3;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? line[i - 3] : 0;
      const b = prev[i];
      const c = i >= 3 ? prev[i - 3] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i] + add) & 0xff;
    }
    if (y === py) return `${line[px * 3]},${line[px * 3 + 1]},${line[px * 3 + 2]}`;
    prev = line;
  }
  throw new Error("pixel out of range");
}

describe("app icons", () => {
  // PNG: 8-byte signature, then IHDR with width/height at bytes 16 and 20.
  const icons: [string, number][] = [
    ["icons/icon-192.png", 192],
    ["icons/icon-512.png", 512],
    ["icons/icon-maskable-512.png", 512],
    ["icons/apple-touch-icon.png", 180],
  ];
  it.each(icons)("%s has the right pixel size and is not a solid colour", (file, size) => {
    const buf = readFileSync(resolve(dist, file));
    expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(buf.readUInt32BE(16)).toBe(size);
    expect(buf.readUInt32BE(20)).toBe(size);
    const colours = new Set<string>();
    for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) colours.add(pixel(buf, x, y));
    // A 9x9 grid of samples (artwork sits in the middle of a plain background).
    for (let i = 1; i <= 9; i++)
      for (let j = 1; j <= 9; j++) colours.add(pixel(buf, Math.floor((size * i) / 10), Math.floor((size * j) / 10)));
    expect(colours.size).toBeGreaterThanOrEqual(5);
  });
});

describe("built service worker", () => {
  const sw = () => read("sw.js");
  const precached = () => [...sw().matchAll(/"?url"?\s*:\s*"([^"]+)"/g)].map((m) => m[1]);

  it("exists and precaches the app shell only", () => {
    expect(existsSync(resolve(dist, "sw.js"))).toBe(true);
    const urls = precached();
    expect(urls.some((u) => /^assets\/.*\.js$/.test(u))).toBe(true);
    expect(urls.some((u) => /^assets\/.*\.css$/.test(u))).toBe(true);
    expect(urls).toContain("index.html");
    expect(urls).toContain("manifest.webmanifest");
    expect(urls.filter((u) => /\.json$/i.test(u))).toEqual([]);
    expect(urls.filter((u) => /indexeddb|backup/i.test(u))).toEqual([]);
  });

  it("has no runtime caching and falls back to index.html for navigation", () => {
    expect(sw()).not.toMatch(/StaleWhileRevalidate|CacheFirst|NetworkFirst/);
    expect(sw()).toMatch(/NavigationRoute/);
    expect(sw()).toMatch(/denylist:\s*\[/);
    expect(sw()).toMatch(/icons/);
    expect(sw()).toMatch(/webmanifest/);
  });
});

describe("built index.html", () => {
  it("links the manifest and iOS install tags, with no theme-color", () => {
    const html = read("index.html");
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
    expect(html).toMatch(/<link rel="apple-touch-icon"/);
    expect(html).toMatch(/<meta name="apple-mobile-web-app-capable" content="yes"/);
    expect(html).toMatch(/<meta name="apple-mobile-web-app-title" content="Esmeworld"/);
    expect(html).not.toMatch(/theme-color/i);
  });
});
