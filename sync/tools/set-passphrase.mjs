#!/usr/bin/env node
// Sets the sync server's SYNC_TOKEN_HASH secret from a passphrase typed with hidden input.
//
//   node sync/tools/set-passphrase.mjs            prompt twice, then `wrangler secret put`
//   node sync/tools/set-passphrase.mjs --dry-run  prompt twice, print only the hash LENGTH
//
// Run it yourself in your own terminal (it refuses to run without one). It never prints,
// logs or writes the passphrase, the token or the hash: only the hash is piped to
// wrangler's stdin, from an empty temporary directory, with an explicit --config.
// Dependency-free on purpose. The derivation below duplicates shared/token.ts
// (NFC-normalize, PBKDF2-HMAC-SHA256, salt "esmeworld-sync-v1", 200000 iterations, 32 bytes, hex;
// hash = SHA-256 of the hex token); tests check that the two agree.

import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MIN_PASSPHRASE_LENGTH = 16;
export const CONFIG_PATH = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
export const WRANGLER_ENTRY = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

const USAGE = "Usage: node sync/tools/set-passphrase.mjs [--dry-run]";

// ---- derivation (keep in sync with shared/token.ts) ----

/** @param {ArrayBuffer} buffer */
function toHex(buffer) {
  let out = "";
  for (const byte of new Uint8Array(buffer)) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** @param {string} passphrase */
export async function deriveToken(passphrase) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(passphrase.normalize("NFC")), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode("esmeworld-sync-v1"), iterations: 200_000 },
    key,
    256,
  );
  return toHex(bits);
}

/** @param {string} token */
export async function hashToken(token) {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

// ---- arguments and checks ----

/**
 * @param {string[]} argv
 * @returns {{ dryRun: boolean, help: boolean }}
 */
export function parseArgs(argv) {
  const result = { dryRun: false, help: false };
  for (const arg of argv) {
    if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
    // Never echo the argument: someone may have typed the passphrase here by mistake.
    else throw new Error(`Unknown argument (not shown). ${USAGE}`);
  }
  return result;
}

/**
 * @param {string} first
 * @param {string} second
 * @returns {string | null} a problem description (never containing the input), or null
 */
export function checkPassphrase(first, second) {
  if (first !== second) return "The two passphrases do not match.";
  if ([...first].length < MIN_PASSPHRASE_LENGTH) return `The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`;
  if (first.trim() !== first) return "The passphrase must not start or end with spaces.";
  return null;
}

/**
 * @param {string} text
 * @param {string[]} secrets
 */
function redact(text, secrets) {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join("[redacted]");
  return out;
}

// ---- wrangler ----

/**
 * Runs `wrangler secret put SYNC_TOKEN_HASH --config <abs>` from an empty temporary
 * directory, piping ONLY the hash (no newline) to its stdin. Wrangler's own output is
 * captured and shown only on failure (with the hash redacted).
 * @param {string} hash
 * @param {{ wranglerEntry?: string, configPath?: string, nodePath?: string }} [options]
 * @returns {Promise<void>}
 */
export async function putSecret(hash, options = {}) {
  const { wranglerEntry = WRANGLER_ENTRY, configPath = CONFIG_PATH, nodePath = process.execPath } = options;
  if (!existsSync(wranglerEntry)) throw new Error("wrangler is not installed: run `npm install` in sync/ first.");
  const dir = await mkdtemp(join(tmpdir(), "esmeworld-secret-"));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(nodePath, [wranglerEntry, "secret", "put", "SYNC_TOKEN_HASH", "--config", configPath], {
        cwd: dir,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      });
      let output = "";
      /** @param {Buffer} chunk */
      const collect = (chunk) => {
        output = (output + chunk.toString("utf8")).slice(-8000);
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.on("error", () => reject(new Error("could not start wrangler")));
      child.on("close", (code) => {
        if (code === 0) resolve(undefined);
        else reject(new Error(`wrangler exited with code ${code}\n${redact(output, [hash]).trim()}`));
      });
      child.stdin.on("error", () => undefined);
      child.stdin.end(hash);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---- hidden prompt ----

/**
 * Applies one chunk of raw terminal input to the value being typed. Pure, so it is testable.
 * Tab is kept (pasted passphrases may contain one); other control characters are dropped.
 * @param {string} value
 * @param {string} chunk
 * @returns {{ value: string, status: "more" | "done" | "cancelled" }}
 */
export function applyKeys(value, chunk) {
  if (chunk.startsWith("\u001b")) return { value, status: "more" }; // arrow keys etc.
  let current = value;
  for (const ch of chunk) {
    if (ch === "\r" || ch === "\n") return { value: current, status: "done" };
    if (ch === "\u0003") return { value: "", status: "cancelled" }; // Ctrl-C
    if (ch === "\u0004") {
      if (current === "") return { value: "", status: "cancelled" }; // Ctrl-D on empty input
      continue;
    }
    if (ch === "\u007f" || ch === "\b") {
      current = [...current].slice(0, -1).join("");
      continue;
    }
    if (ch === "\u0015") {
      current = ""; // Ctrl-U clears the line
      continue;
    }
    if (ch === "\t") {
      current += ch;
      continue;
    }
    if (ch < " ") continue;
    current += ch;
  }
  return { value: current, status: "more" };
}

const SIGNAL_EXIT_CODES = /** @type {const} */ ({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 });

/**
 * Turns raw mode on and guarantees it is turned off again: via the returned function
 * (call it in a `finally`), on process exit, on SIGINT/SIGTERM/SIGHUP and on a crash.
 * @param {{ setRawMode(on: boolean): unknown, pause?: () => unknown }} stdin
 * @param {{ on: Function, off: Function, exit: (code: number) => unknown, stderr: { write(s: string): unknown } }} [proc]
 * @returns {() => void}
 */
export function rawModeGuard(stdin, proc = process) {
  let active = true;
  const restore = () => {
    if (!active) return;
    active = false;
    try {
      stdin.setRawMode(false);
    } catch {
      // the terminal may already be gone
    }
    stdin.pause?.();
    proc.off("exit", restore);
    proc.off("uncaughtException", onCrash);
    for (const signal of Object.keys(SIGNAL_EXIT_CODES)) proc.off(signal, onSignal);
  };
  /** @param {keyof typeof SIGNAL_EXIT_CODES} signal */
  const onSignal = (signal) => {
    restore();
    proc.exit(SIGNAL_EXIT_CODES[signal] ?? 1);
  };
  const onCrash = () => {
    restore();
    proc.stderr.write("\nUnexpected error; nothing was set.\n"); // never the error itself
    proc.exit(1);
  };
  stdin.setRawMode(true);
  proc.on("exit", restore);
  proc.on("uncaughtException", onCrash);
  for (const signal of Object.keys(SIGNAL_EXIT_CODES)) proc.on(signal, onSignal);
  return restore;
}

/**
 * Reads one line from the terminal without echoing it (interactive only; not run by tests).
 * @param {string} question
 * @returns {Promise<string>}
 */
async function promptHidden(question) {
  const { stdin, stderr } = process;
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("This script must be run in an interactive terminal.");
  }
  stderr.write(question);
  const restore = rawModeGuard(stdin);
  /** @type {((chunk: string) => void) | undefined} */
  let onData;
  try {
    stdin.setEncoding("utf8");
    stdin.resume();
    return await new Promise((resolve, reject) => {
      let value = "";
      onData = (chunk) => {
        const next = applyKeys(value, chunk);
        value = next.value;
        if (next.status === "done") resolve(value);
        else if (next.status === "cancelled") reject(new Error("Cancelled."));
      };
      stdin.on("data", onData);
    });
  } finally {
    if (onData) stdin.off("data", onData);
    restore();
    stderr.write("\n");
  }
}

// ---- orchestration ----

/**
 * @param {{
 *   argv: string[],
 *   prompt: (question: string) => Promise<string>,
 *   out: (line: string) => void,
 *   err: (line: string) => void,
 *   setSecret: (hash: string) => Promise<void>,
 * }} io
 * @returns {Promise<number>} exit code
 */
export async function run({ argv, prompt, out, err, setSecret }) {
  /** @type {{ dryRun: boolean, help: boolean }} */
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    err(error instanceof Error ? error.message : USAGE);
    return 2;
  }
  if (args.help) {
    out(USAGE);
    return 0;
  }

  let first;
  let second;
  try {
    first = await prompt("Sync passphrase (hidden): ");
    second = await prompt("Repeat it (hidden): ");
  } catch (error) {
    err(error instanceof Error ? error.message : "Cancelled.");
    return 1;
  }
  const problem = checkPassphrase(first, second);
  if (problem) {
    err(problem);
    return 1;
  }

  const token = await deriveToken(first);
  const hash = await hashToken(token);
  if (args.dryRun) {
    out(String(hash.length));
    return 0;
  }
  try {
    await setSecret(hash);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    err(`Could not set the secret: ${redact(message, [first, token, hash])}`);
    return 1;
  }
  out("Secret set.");
  return 0;
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  const code = await run({
    argv: process.argv.slice(2),
    prompt: promptHidden,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    setSecret: (hash) => putSecret(hash),
  });
  process.exitCode = code;
}
