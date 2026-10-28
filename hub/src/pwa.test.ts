// @vitest-environment node
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// These tests read the BUILT output. They run `npm run build` themselves so that
// `npx vitest run` is green from a clean checkout (the build takes a few seconds).
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");
const read = (f: string) => readFileSync(resolve(dist, f), "utf8");

beforeAll(() => {
  execSync("npm run build", { cwd: root, stdio: "pipe" });
}, 180_000);

describe("built manifest", () => {
  it("has the install fields and no invented colours", () => {
    const m = JSON.parse(read("manifest.webmanifest"));
    expect(m.name).toBe("Life Hub");
    expect(m.short_name).toBe("Life Hub");
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
  });
});

describe("built index.html", () => {
  it("links the manifest and iOS install tags, with no theme-color", () => {
    const html = read("index.html");
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
    expect(html).toMatch(/<link rel="apple-touch-icon"/);
    expect(html).toMatch(/<meta name="apple-mobile-web-app-capable" content="yes"/);
    expect(html).toMatch(/<meta name="apple-mobile-web-app-title" content="Life Hub"/);
    expect(html).not.toMatch(/theme-color/i);
  });
});
