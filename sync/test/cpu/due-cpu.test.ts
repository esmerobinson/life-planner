import { describe, expect, it } from "vitest";
import { parseDueState, type DueRemote } from "../../src/due/client";
import { DEFAULT_DUE_PREFS } from "../../src/due/prefs";
import { planCalls, versionId } from "../../src/due/reconcile";
import { wantedReminders, type DueItem } from "../../src/due/rules";

// The CPU of one run's own work (review I3): the free plan allows 10 ms per invocation.
// Due's state grows by about 30 reminders a day (cancelled ones are kept), so 10,000 is about a
// year. 5,000 open to-dos is far more than the cron's SQL hands the rules (MAX_ITEM_ROWS 1,500,
// already filtered to what can matter today). Best of several runs, after a warm-up, as a
// Worker reuses its isolate. D1 and the network are I/O (not CPU) and aren't measured here.
// Runs in Node (vitest "cpu" project): inside workerd the clock doesn't move during CPU work.

const NOW = Date.parse("2026-11-16T12:45:00-05:00");
const DAYS = ["20261115", "20261116", "20261117"];

function bigState(n: number): string {
  const reminders: unknown[] = [];
  for (let i = 0; i < n; i++) {
    const month = String(1 + (i % 10)).padStart(2, "0");
    reminders.push({
      id: `esmeworld-2026${month}${String(1 + (i % 28)).padStart(2, "0")}-d1-0190a1b2-c3d4-7e5f-8a9b-${String(i).padStart(12, "0")}-v0000abcd`,
      title: `A pretend to-do title number ${i}`,
      dueAt: "2026-06-01T11:00:00",
      notes: "From Esmeworld",
      type: "esmeworld",
      completedAt: null,
      deletedAt: "2026-06-02T08:00:00.000Z",
      createdAt: "2026-06-01T08:00:00.000Z",
    });
    if (i % 5 === 0) reminders.push({ id: `oliver-${i}`, title: "Not ours", type: "manual", dueAt: "2026-06-01T11:00:00", completedAt: null, deletedAt: null });
  }
  // Today's own, spread through the list.
  for (let j = 0; j < 30; j++) {
    reminders.splice(j * 300, 0, {
      id: `esmeworld-20261116-d1-item${j}-v1234abcd`, title: `Today ${j}`, dueAt: "2026-11-16T11:00:00",
      notes: "From Esmeworld", type: "esmeworld", completedAt: null, deletedAt: null,
    });
  }
  return JSON.stringify({ state: { reminders } });
}

const items: DueItem[] = Array.from({ length: 5000 }, (_, i) => ({
  id: `0190a1b2-c3d4-7e5f-8a9b-${String(i).padStart(12, "0")}`,
  title: `A pretend to-do title number ${i}`,
  kind: "task",
  status: "open",
  areaId: "admin",
  priority: (1 + (i % 3)) as 1 | 2 | 3,
  due: i % 2 ? "2026-11-16" : "2026-11-10",
  ...(i % 7 === 0 ? { recur: ["mon", "thu"] } : {}),
  ...(i % 50 === 0 ? { time: `1${i % 10}:30` } : {}),
}));

function best(fn: () => void, runs = 7): number {
  fn(); // warm-up
  let min = Infinity;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    min = Math.min(min, performance.now() - t);
  }
  return min;
}

describe("Due reminders: CPU of one run", () => {
  const state = bigState(10_000);
  const prefs = { ...DEFAULT_DUE_PREFS, on: true, lines: ["One", "Two"] };

  it("10,000 reminders in Due and 5,000 to-dos stay well under 10 ms", () => {
    const bytes = new TextEncoder().encode(state);
    const decode = best(() => void new TextDecoder().decode(bytes));
    const parse = best(() => void parseDueState(state, DAYS));
    const rules = best(() => void wantedReminders({ items, prefs, now: NOW, tickedToday: false }));
    const remote = parseDueState(state, DAYS);
    const wanted = wantedReminders({ items, prefs, now: NOW, tickedToday: false });
    const plan = best(() => void planCalls(wanted, remote, new Set(), NOW));
    const total = decode + parse + rules + plan;
    // Shown with the test output, for the report.
    console.info(`due cpu: state ${(state.length / 1e6).toFixed(1)} MB decode ${decode.toFixed(2)} ms, parse ${parse.toFixed(2)} ms, rules ${rules.toFixed(2)} ms, plan ${plan.toFixed(2)} ms, total ${total.toFixed(2)} ms`);
    expect(remote).toHaveLength(30);
    expect(remote.every((r: DueRemote) => r.id.startsWith("esmeworld-20261116-"))).toBe(true);
    expect(wanted.length).toBeGreaterThan(0);
    expect(versionId(wanted[0]!)).toMatch(/-v[0-9a-f]{8}$/);
    // About 3.7 ms on an M-series Mac; the margin is for a busy machine.
    expect(total).toBeLessThan(6);
  });
});
