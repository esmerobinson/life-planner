// Copies the approved Esme World UI kit (art/options/esme-ui) into the app (src/assets/rio-ui/):
// the kit's pieces and kit.json, and the body pixel font (font-small) with its metrics.
// Usage: node scripts/import-rio-ui.mjs <esme-ui dir> [<rio-pack>/day1/ui/tab-icons]
// The optional second folder adds the menu's tab icons drawn for Rio (gear, recipe book): only its
// own *.png files, never previews/ or src/.
// Never the review/ folder, samples or previews; never the screen-specific extra-* pieces, except
// the ones the game uses (EXTRAS: the hammer on the hotbar's Arrange, 2026-11-17).

import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const kitDir = process.argv[2];
const tabIconsDir = process.argv[3];
if (!kitDir) {
  console.error("Usage: node scripts/import-rio-ui.mjs <esme-ui dir>");
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets", "rio-ui");

const EXTRAS = ["extra-s-hammer.png"];
const files = [
  ...readdirSync(join(kitDir, "kit"))
    .filter((f) => (f.endsWith(".png") && (!f.startsWith("extra-") || EXTRAS.includes(f))) || f === "kit.json")
    .map((f) => `kit/${f}`),
  "font/font-small.png",
  "font/fonts.json",
];

rmSync(out, { recursive: true, force: true });
let bytes = 0;
for (const rel of files) {
  const to = join(out, rel);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(kitDir, rel), to);
  bytes += statSync(to).size;
}
let tabIcons = 0;
if (tabIconsDir) {
  mkdirSync(join(out, "tab-icons"), { recursive: true });
  for (const f of readdirSync(tabIconsDir).filter((n) => n.endsWith(".png"))) {
    copyFileSync(join(tabIconsDir, f), join(out, "tab-icons", f));
    bytes += statSync(join(out, "tab-icons", f)).size;
    tabIcons++;
  }
}
console.log(`${files.length + tabIcons} files, ${(bytes / 1024).toFixed(1)} KB`);
