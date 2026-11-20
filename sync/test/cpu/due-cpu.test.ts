import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseDueState, type DueRemote } from "../../src/due/client";
import { planCalls } from "../../src/due/reconcile";
import { wantedReminders } from "../../src/due/rules";
import { ACTIVE_PER_DAY, bigItems, bigState, CASES, FILL, MATCHING_PER_DAY, PREFS } from "./fixtures";

// The CPU of one run's own work (re-review R-I1); the free plan allows 10 ms per invocation.
// A year of Due (about 10,000 earlier reminders, ids sharing the needle's start, plus the
// searched days' own) and 5,000 to-dos warm (the cron's SQL hands the rules at most 300).
// Measured warm (best of 7) and COLD, in a fresh Node process per case. D1 and the network are
// I/O (not CPU) and aren't measured. Node is not workerd: Cloudflare's own CPU time after the
// first deploy is the real check (report).

function best(fn: () => void, runs = 7): number {
  fn();
  let min = Infinity;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    min = Math.min(min, performance.now() - t);
  }
  return min;
}

const items = bigItems(5000);

describe("Due reminders: CPU of one run, warm", () => {
  for (const c of CASES) {
    it(`${c.name}: finds exactly the searched days' reminders, without falling back, well under 10 ms`, () => {
      const state = bigState(c);
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const parse = best(() => void parseDueState(state, c.days));
      const remote = parseDueState(state, c.days);
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
      const rules = best(() => void wantedReminders({ items, prefs: PREFS, now: c.now, tickedToday: false, fill: FILL }));
      const wanted = wantedReminders({ items, prefs: PREFS, now: c.now, tickedToday: false, fill: FILL });
      const plan = best(() => void planCalls(wanted, remote, new Set(), c.now));
      const total = parse + rules + plan;
      console.info(`due cpu warm ${c.name}: state ${(state.length / 1e6).toFixed(1)} MB parse ${parse.toFixed(2)} rules ${rules.toFixed(2)} plan ${plan.toFixed(2)} total ${total.toFixed(2)} ms`);
      expect(remote).toHaveLength(MATCHING_PER_DAY * 3);
      expect(remote.filter((r: DueRemote) => r.deletedAt === null)).toHaveLength(ACTIVE_PER_DAY * 3);
      expect(remote.every((r: DueRemote) => c.days.some((d) => r.id.startsWith(`esmeworld-${d}-`)))).toBe(true);
      // About 3 ms on an M-series Mac; the margin is for a busy machine.
      expect(total).toBeLessThan(6);
    });
  }

  it("a state not shaped as expected falls back to a full parse, logged once as a fixed code", () => {
    const text = JSON.stringify({ items: Array.from({ length: 3000 }, (_, i) => ({ id: `esmeworld-20261116-d1-x${i}-v0000abcd`, type: "esmeworld", title: "x".repeat(80), completedAt: null, deletedAt: null })) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => parseDueState(text, ["20261116"])).toThrow(); // no reminders array: Due's state is unreadable
    expect(errors.mock.calls).toEqual([["due_reminders_state_fallback"]]);
    errors.mockRestore();
  });
});

describe("Due reminders: CPU of one run, cold (a fresh process)", () => {
  let dir = "";
  let bundle = "";
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "due-cpu-"));
    bundle = join(dir, "coldRun.mjs");
    await build({
      entryPoints: [fileURLToPath(new URL("./coldRun.ts", import.meta.url))],
      bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "silent",
    });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  for (const c of CASES) {
    it(`${c.name}: the first run in a cold process, 300 to-dos (the SQL's most), stays under 10 ms`, () => {
      // Best of 3 fresh processes (a fresh process each time: every one is cold). Wall-clock
      // time in Node, so a busy machine adds noise; the best of 3 is the run's own cost.
      const runs = Array.from({ length: 3 }, () => {
        const out = spawnSync(process.execPath, [bundle, c.name, "300"], { encoding: "utf8" });
        expect(out.status, out.stderr).toBe(0);
        return JSON.parse(out.stdout) as { parse: number; rules: number; plan: number; total: number; found: number; fallbacks: number };
      });
      const r = runs.reduce((a, b) => (b.total < a.total ? b : a));
      console.info(`due cpu cold ${c.name}: parse ${r.parse.toFixed(2)} rules ${r.rules.toFixed(2)} plan ${r.plan.toFixed(2)} total ${r.total.toFixed(2)} ms`);
      expect(r.found).toBe(MATCHING_PER_DAY * 3);
      expect(r.fallbacks).toBe(0);
      expect(r.total).toBeLessThan(10);
    });
  }
});
