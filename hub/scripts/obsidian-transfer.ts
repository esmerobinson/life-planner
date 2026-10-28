// One-time transfer: Obsidian notes + Google Tasks export -> an Esmeworld backup file.
//
//   npx tsx scripts/obsidian-transfer.ts [--vault DIR] [--gtasks FILE] [--out DIR]
//                                        [--today YYYY-MM-DD] [--classify-out FILE] [--areas FILE] [--extra FILE]
//
// It only reads the vault and the Google file. It writes two private (0600) files into
// --out: esmeworld-transfer-<today>.json (load it on the Backup page with Merge) and
// esmeworld-transfer-<today>-summary.md. The terminal shows counts only, never titles.
import { homedir } from "node:os";
import { join } from "node:path";
import { isValidISODate, todayISO } from "../src/domain/dates";
import { formatFailure, runTransfer } from "./transfer";

const FLAGS = ["--vault", "--gtasks", "--out", "--today", "--classify-out", "--areas", "--extra"] as const;

function main(argv: string[]) {
  const given: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!(FLAGS as readonly string[]).includes(flag) || value === undefined) {
      throw new Error(`Unknown or incomplete option. Options: ${FLAGS.join(", ")}.`);
    }
    given[flag] = value;
  }
  const home = homedir();
  const today = given["--today"] ?? todayISO();
  if (!isValidISODate(today)) throw new Error("--today must be a real date like 2026-10-28.");
  const { lines } = runTransfer({
    vault: given["--vault"] ?? join(home, "Desktop", "Esme's Brain", "Goals & Direction"),
    gtasks: given["--gtasks"] ?? join(home, "Downloads", "esmeworld-google-tasks.json"),
    out: given["--out"] ?? join(home, "Downloads"),
    today,
    classifyOut: given["--classify-out"],
    areasFile: given["--areas"],
    extraFile: given["--extra"],
  });
  for (const l of lines) console.log(l);
}

try {
  main(process.argv.slice(2));
} catch (e) {
  console.error(formatFailure(e));
  process.exit(1);
}
