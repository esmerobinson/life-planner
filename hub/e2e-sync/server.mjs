// Starts the REAL sync server code (../sync, Cloudflare Worker + D1) locally for the opt-in
// end-to-end check (`npm run e2e:sync`). Never deploys, never touches Cloudflare:
// - wrangler runs from a fresh, EMPTY temp directory with an explicit --config pointing at
//   sync/wrangler.jsonc (never the repo-root wrangler.jsonc, a legacy worker) and --local;
// - the local D1 database and all state live in that temp directory;
// - the passphrase is a throwaway test value; only its hash goes into a temp .dev.vars.
import { spawn, spawnSync } from "node:child_process";
import { createHash, pbkdf2Sync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Obviously fake; used only against this throwaway local server. */
export const E2E_PASSPHRASE = "e2e-fake-passphrase-not-real-0000";
export const E2E_SYNC_PORT = Number(process.env.E2E_SYNC_PORT ?? 8790);

const syncDir = fileURLToPath(new URL("../../sync/", import.meta.url));
const config = join(syncDir, "wrangler.jsonc");
const wrangler = join(syncDir, "node_modules", ".bin", "wrangler");

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const token = pbkdf2Sync(E2E_PASSPHRASE.normalize("NFC"), "esmeworld-sync-v1", 200_000, 32, "sha256").toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  const work = mkdtempSync(join(tmpdir(), "esmeworld-e2e-sync-"));
  const vars = join(work, ".dev.vars");
  writeFileSync(vars, `SYNC_TOKEN_HASH=${hash}\n`, { mode: 0o600 });
  const state = join(work, "state");
  const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };

  const migrate = spawnSync(
    wrangler,
    ["d1", "migrations", "apply", "esmeworld-sync", "--local", "--config", config, "--persist-to", state],
    { cwd: work, env, stdio: "inherit" },
  );
  if (migrate.status !== 0) process.exit(migrate.status ?? 1);

  const dev = spawn(
    wrangler,
    ["dev", "--local", "--config", config, "--persist-to", state, "--env-file", vars,
      "--ip", "127.0.0.1", "--port", String(E2E_SYNC_PORT)],
    { cwd: work, env, stdio: "inherit" },
  );
  const stop = () => dev.kill("SIGTERM");
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  dev.on("exit", (code) => process.exit(code ?? 0));
}
