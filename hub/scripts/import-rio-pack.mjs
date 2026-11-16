// Copies the finished Rio art pack into the app (src/assets/rio/), keeping relative paths.
// Usage: node scripts/import-rio-pack.mjs <rio-pack dir>
// Only the final folders the app reads; never previews, scratch, review-only or no-esme files.
// Phase 2a adds the areas drawn since phase 1 (scenes only) and the map's holiday takeovers. Their
// dish, ingredient and sticker art waits for phase 2b (recipes, Zona Sul's stock, the v3 families).

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
  "week2/zona-sul",
  "week2/jardim-botanico",
  "later/quilo",
  "later/sult",
  "later/os-esquilos",
  "later/santa-teresa",
  "later/arpoador-sea",
  "week3/museum-looks",
];
// The museum's day art is the finished esme pack's (summer = the Rio day), beside the rio pack; only
// what the Rio museum reads (its night and rain are week3/museum-looks).
const MUSEUM_DAY = "esme-pack/week2-4/museum";
const MUSEUM_DAY_FILES = [
  "location/plaza-summer.png",
  "location/museum-doors-open.png",
  "location/plaza-slots.json",
  "inside/hall-summer.png",
  "inside/room-hall.json",
  "inside/pieces/case-glass.png",
];
const SKIP = [
  /\/previews\//, /\/_scratch\//, /REVIEW-ONLY/, /\/no-esme\//,
  // Phase 2b: dishes, ingredients and the new areas' stickers are not in the game yet.
  /^\/(week2|later)\/[^/]+\/(dishes|ingredients|stickers)\//,
];

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
for (const f of MUSEUM_DAY_FILES) {
  const from = join(pack, "..", MUSEUM_DAY, f);
  const to = join(out, MUSEUM_DAY, f);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  count++;
  bytes += statSync(from).size;
}
console.log(`${count} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
