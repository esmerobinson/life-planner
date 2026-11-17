// One run's own work in a FRESH process (bundled and run by due-cpu.test.ts): the time of the
// first call of each step, as a cold Worker isolate would see it. Module-scope work (the Intl
// warm-up in time.ts) happens at import, like an isolate's start-up, before the clock starts.
// Prints one line of JSON.

import { parseDueState } from "../../src/due/client";
import { planCalls } from "../../src/due/reconcile";
import { wantedReminders } from "../../src/due/rules";
import { bigItems, bigState, CASES, PREFS } from "./fixtures";

const c = CASES.find((x) => x.name === process.argv[2]) ?? CASES[0]!;
const state = bigState(c);
const items = bigItems(Number(process.argv[3] ?? 300));
const fallbacks: unknown[] = [];
console.error = (...args: unknown[]) => void fallbacks.push(args);

const t0 = performance.now();
const remote = parseDueState(state, c.days);
const t1 = performance.now();
const wanted = wantedReminders({ items, prefs: PREFS, now: c.now, tickedToday: false });
const t2 = performance.now();
planCalls(wanted, remote, new Set(), c.now);
const t3 = performance.now();
process.stdout.write(
  `${JSON.stringify({ case: c.name, parse: t1 - t0, rules: t2 - t1, plan: t3 - t2, total: t3 - t0, found: remote.length, fallbacks: fallbacks.length })}\n`,
);
