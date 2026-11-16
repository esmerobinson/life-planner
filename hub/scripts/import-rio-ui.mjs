// Copies the approved Esme World UI kit (art/options/esme-ui) into the app (src/assets/rio-ui/):
// the kit's pieces and kit.json, and the body pixel font (font-small) with its metrics.
// Usage: node scripts/import-rio-ui.mjs <esme-ui dir>
// Never the review/ folder, samples or previews; never the screen-specific extra-* pieces.

import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const kitDir = process.argv[2];
if (!kitDir) {
  console.error("Usage: node scripts/import-rio-ui.mjs <esme-ui dir>");
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets", "rio-ui");

const files = [
  ...readdirSync(join(kitDir, "kit"))
    .filter((f) => (f.endsWith(".png") && !f.startsWith("extra-")) || f === "kit.json")
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
console.log(`${files.length} files, ${(bytes / 1024).toFixed(1)} KB`);
