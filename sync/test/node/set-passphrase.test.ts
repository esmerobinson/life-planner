// Tests for tools/set-passphrase.mjs. The interactive hidden prompt is NOT exercised:
// `run` takes the prompt as a parameter, and `putSecret` is pointed at a fake wrangler.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import {
  applyKeys,
  checkPassphrase,
  CONFIG_PATH,
  deriveToken,
  hashToken,
  MIN_PASSPHRASE_LENGTH,
  parseArgs,
  putSecret,
  rawModeGuard,
  run,
} from "../../tools/set-passphrase.mjs";
import { deriveToken as sharedDeriveToken, hashToken as sharedHashToken } from "../../shared/token.ts";

const FAKE = "test-passphrase-not-real";
const FAKE_TOKEN = "c46c879c74e03f56bfd1fd6c133cc7548962cf2c20ec7b3dc45402c27f42f39e";
const FAKE_HASH = "428f0b314ff5d2f521073d705fb037e2bc63b3e54c72e14c811d69c861db9d98";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function capture() {
  const lines: string[] = [];
  return { lines, write: (line: string) => void lines.push(line) };
}

describe("set-passphrase: derivation (duplicated from shared/token.ts)", () => {
  it("derives the same fixed vector as shared/token.ts", async () => {
    expect(await deriveToken(FAKE)).toBe(FAKE_TOKEN);
    expect(await hashToken(FAKE_TOKEN)).toBe(FAKE_HASH);
  });

  it("normalizes to NFC like shared/token.ts", async () => {
    const composed = "café-crème-brûlée-fake";
    const expected = "503c56a3aae540c2834aed2f246320cac35988940481faf07f1fb3e30201eda6";
    expect(await deriveToken(composed)).toBe(expected);
    expect(await deriveToken(composed.normalize("NFD"))).toBe(expected);
  });

  it("agrees with shared/token.ts on other inputs", async () => {
    for (const passphrase of ["another-fake-passphrase", "ünïcøde-fake-passphrase \u{1F511}"]) {
      const token = await deriveToken(passphrase);
      expect(token).toBe(await sharedDeriveToken(passphrase));
      expect(await hashToken(token)).toBe(await sharedHashToken(token));
    }
  });
});

describe("set-passphrase: arguments", () => {
  it("parses no arguments and --dry-run", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, help: false });
    expect(parseArgs(["--dry-run"])).toEqual({ dryRun: true, help: false });
    expect(parseArgs(["--help"])).toEqual({ dryRun: false, help: true });
    expect(parseArgs(["-h"])).toEqual({ dryRun: false, help: true });
  });

  it("rejects anything else (in particular a passphrase on the command line)", () => {
    expect(() => parseArgs(["--passphrase", FAKE])).toThrow(/unknown argument/i);
    expect(() => parseArgs([FAKE])).toThrow(/unknown argument/i);
    expect(() => parseArgs(["--dry-run", "--dry-run=false"])).toThrow(/unknown argument/i);
  });

  it("does not echo a rejected argument (it might be a passphrase)", () => {
    let message = "";
    try {
      parseArgs([FAKE]);
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/unknown argument/i);
    expect(message).not.toContain(FAKE);
  });

  it("uses an absolute path to sync/wrangler.jsonc", () => {
    expect(isAbsolute(CONFIG_PATH)).toBe(true);
    expect(CONFIG_PATH.endsWith(join("sync", "wrangler.jsonc"))).toBe(true);
    expect(existsSync(CONFIG_PATH)).toBe(true);
  });
});

describe("set-passphrase: passphrase checks", () => {
  it(`requires at least ${16} characters`, () => {
    expect(MIN_PASSPHRASE_LENGTH).toBe(16);
    expect(checkPassphrase("x".repeat(15), "x".repeat(15))).toMatch(/at least 16/);
    expect(checkPassphrase("x".repeat(16), "x".repeat(16))).toBeNull();
  });

  it("counts characters, not UTF-16 units", () => {
    const emoji = "\u{1F511}".repeat(15); // 15 characters, 30 UTF-16 units
    expect(checkPassphrase(emoji, emoji)).toMatch(/at least 16/);
  });

  it("requires both entries to match", () => {
    expect(checkPassphrase(FAKE, `${FAKE}x`)).toMatch(/do not match/);
  });

  it("rejects leading/trailing whitespace (easy to mistype invisibly)", () => {
    expect(checkPassphrase(` ${FAKE}`, ` ${FAKE}`)).toMatch(/spaces/);
    expect(checkPassphrase(`${FAKE} `, `${FAKE} `)).toMatch(/spaces/);
  });
});

describe("set-passphrase: key handling of the hidden prompt", () => {
  it("keeps a Tab inside a pasted passphrase", () => {
    expect(applyKeys("", "fake\tpass\tphrase")).toEqual({ value: "fake\tpass\tphrase", status: "more" });
    expect(applyKeys("", "fake\tpass\r")).toEqual({ value: "fake\tpass", status: "done" });
  });

  it("finishes on Enter, cancels on Ctrl-C and on Ctrl-D with empty input", () => {
    expect(applyKeys("abc", "\n")).toEqual({ value: "abc", status: "done" });
    expect(applyKeys("abc", "\u0003").status).toBe("cancelled");
    expect(applyKeys("", "\u0004").status).toBe("cancelled");
    expect(applyKeys("abc", "\u0004")).toEqual({ value: "abc", status: "more" });
  });

  it("handles Backspace per character (code point), Ctrl-U, and ignores escape sequences", () => {
    expect(applyKeys("ab\u{1F511}", "\u007f")).toEqual({ value: "ab", status: "more" });
    expect(applyKeys("ab", "\b")).toEqual({ value: "a", status: "more" });
    expect(applyKeys("abc", "\u0015x")).toEqual({ value: "x", status: "more" });
    expect(applyKeys("abc", "\u001b[A")).toEqual({ value: "abc", status: "more" });
    expect(applyKeys("abc", "\u0001\u0002d")).toEqual({ value: "abcd", status: "more" });
  });
});

describe("set-passphrase: raw-mode guard", () => {
  class FakeStdin {
    calls: boolean[] = [];
    paused = false;
    setRawMode(on: boolean) {
      this.calls.push(on);
    }
    pause() {
      this.paused = true;
    }
  }
  class FakeProcess extends EventEmitter {
    exitCodes: number[] = [];
    stderr = { write: (_s: string) => true };
    exit(code: number) {
      this.exitCodes.push(code);
    }
  }

  it("enables raw mode and restores it exactly once via the returned function", () => {
    const stdin = new FakeStdin();
    const proc = new FakeProcess();
    const restore = rawModeGuard(stdin, proc);
    expect(stdin.calls).toEqual([true]);
    restore();
    restore();
    expect(stdin.calls).toEqual([true, false]);
    expect(proc.listenerCount("exit")).toBe(0);
    expect(proc.listenerCount("SIGTERM")).toBe(0);
  });

  it.each(["exit", "SIGINT", "SIGTERM", "SIGHUP", "uncaughtException"])("restores the terminal on %s", (event) => {
    const stdin = new FakeStdin();
    const proc = new FakeProcess();
    rawModeGuard(stdin, proc);
    proc.emit(event, event === "uncaughtException" ? new Error("boom") : event);
    expect(stdin.calls).toEqual([true, false]);
    if (event !== "exit") expect(proc.exitCodes).toHaveLength(1);
  });
});

describe("set-passphrase: run (with an injected prompt)", () => {
  it("--dry-run prints only the hash length and never calls wrangler", async () => {
    const out = capture();
    const err = capture();
    let called = false;
    const code = await run({
      argv: ["--dry-run"],
      prompt: async () => FAKE,
      out: out.write,
      err: err.write,
      setSecret: async () => {
        called = true;
      },
    });
    expect(code).toBe(0);
    expect(called).toBe(false);
    expect(out.lines).toEqual(["64"]);
    const everything = [...out.lines, ...err.lines].join("\n");
    for (const secret of [FAKE, FAKE_TOKEN, FAKE_HASH]) expect(everything).not.toContain(secret);
  });

  it("sets the secret with only the hash and prints just 'Secret set.'", async () => {
    const out = capture();
    const err = capture();
    const received: string[] = [];
    const code = await run({
      argv: [],
      prompt: async () => FAKE,
      out: out.write,
      err: err.write,
      setSecret: async (hash: string) => {
        received.push(hash);
      },
    });
    expect(code).toBe(0);
    expect(received).toEqual([FAKE_HASH]);
    expect(out.lines).toEqual(["Secret set."]);
    expect(err.lines).toEqual([]);
  });

  it("refuses a short or mismatched passphrase without calling wrangler", async () => {
    const answers = ["short-fake", "short-fake"];
    const err = capture();
    let called = false;
    const code = await run({
      argv: [],
      prompt: async () => answers.shift() ?? "",
      out: () => undefined,
      err: err.write,
      setSecret: async () => {
        called = true;
      },
    });
    expect(code).toBe(1);
    expect(called).toBe(false);
    expect(err.lines.join("\n")).not.toContain("short-fake");
  });

  it("reports a wrangler failure without printing secrets", async () => {
    const out = capture();
    const err = capture();
    const code = await run({
      argv: [],
      prompt: async () => FAKE,
      out: out.write,
      err: err.write,
      setSecret: async () => {
        throw new Error("wrangler exited with code 1");
      },
    });
    expect(code).toBe(1);
    expect(out.lines).toEqual([]);
    const everything = err.lines.join("\n");
    for (const secret of [FAKE, FAKE_TOKEN, FAKE_HASH]) expect(everything).not.toContain(secret);
  });
});

describe("set-passphrase: putSecret (against a fake wrangler)", () => {
  function fakeWrangler(exitCode: number) {
    const dir = mkdtempSync(join(tmpdir(), "fake-wrangler-"));
    scratch.push(dir);
    const report = join(dir, "report.json");
    const script = join(dir, "wrangler.mjs");
    writeFileSync(
      script,
      `import { readdirSync, writeFileSync } from "node:fs";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  writeFileSync(${JSON.stringify(report)}, JSON.stringify({
    args: process.argv.slice(2), cwd: process.cwd(), cwdEntries: readdirSync(process.cwd()), input,
    metrics: process.env.WRANGLER_SEND_METRICS ?? null,
  }));
  if (${exitCode} !== 0) { console.error("fake wrangler failure for " + input); process.exit(${exitCode}); }
  console.log("fake wrangler output");
});
`,
    );
    return { script, report };
  }

  it("pipes only the hash to `wrangler secret put` with --config, from an empty temp dir that is removed", async () => {
    const { script, report } = fakeWrangler(0);
    await putSecret(FAKE_HASH, { wranglerEntry: script, configPath: CONFIG_PATH });
    const seen = JSON.parse(readFileSync(report, "utf8")) as {
      args: string[];
      cwd: string;
      cwdEntries: string[];
      input: string;
      metrics: string | null;
    };
    expect(seen.args).toEqual(["secret", "put", "SYNC_TOKEN_HASH", "--config", CONFIG_PATH]);
    expect(seen.input).toBe(FAKE_HASH);
    expect(seen.cwdEntries).toEqual([]);
    expect(seen.cwd).not.toContain("life-planner");
    expect(existsSync(seen.cwd)).toBe(false);
    expect(seen.metrics).toBe("false");
  });

  it("rejects on a wrangler failure, redacts the hash from its output, and still removes the temp dir", async () => {
    const { script, report } = fakeWrangler(3);
    const error = await putSecret(FAKE_HASH, { wranglerEntry: script, configPath: CONFIG_PATH }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(String(error)).toMatch(/exited with code 3/);
    expect(String(error)).not.toContain(FAKE_HASH);
    expect(String(error)).toContain("fake wrangler failure for [redacted]");
    const seen = JSON.parse(readFileSync(report, "utf8")) as { cwd: string };
    expect(existsSync(seen.cwd)).toBe(false);
  });
});
