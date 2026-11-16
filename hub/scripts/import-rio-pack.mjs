// Copies the finished Rio art pack into the app (src/assets/rio/), keeping relative paths.
// Usage: node scripts/import-rio-pack.mjs <rio-pack dir>
// Only the final folders the app reads; never previews, scratch, review-only or no-esme files.

import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const AREAS = [
  "day1/map",
  "day1/lagoa-house",
  "day1/fazenda",
  "day1/ipanema",
  "day1/clothing-store",
  "week1/tijuca-park",
  "later/boteco",
];
const SKIP = [/\/previews\//, /\/_scratch\//, /REVIEW-ONLY/, /\/no-esme\//];

const pack = process.argv[2];
if (!pack) {
  console.error("Usage: node scripts/import-rio-pack.mjs <rio-pack dir>");
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets", "rio");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

rmSync(out, { recursive: true, force: true });
let count = 0;
let bytes = 0;
for (const area of AREAS) {
  for (const file of walk(join(pack, area))) {
    const rel = relative(pack, file);
    if (!/\.(png|json)$/.test(rel) || SKIP.some((re) => re.test(`/${rel}`))) continue;
    const to = join(out, rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(file, to);
    count++;
    bytes += statSync(file).size;
  }
}
console.log(`${count} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
