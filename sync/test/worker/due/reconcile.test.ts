import { beforeEach, describe, expect, it } from "vitest";
import { DueClient } from "../../../src/due/client";
import { NOTES, planCalls, reconcile } from "../../../src/due/reconcile";
import type { Wanted } from "../../../src/due/rules";
import { FAKE_DUE_TOKEN, FAKE_DUE_URL, FakeDue } from "./fakeDue";

const NY = "America/New_York";
const at = (local: string) => Date.parse(`${local}-05:00`);
const NOW = at("2026-11-16T08:00:00");
const w = (id: string, local: string, title = `T ${id}`): Wanted => ({ id: `esmeworld-2026-11-16-${id}`, kind: "plan", title, at: at(local) });

let due: FakeDue;
const client = (maxCalls = 40) => new DueClient({ baseUrl: FAKE_DUE_URL, token: FAKE_DUE_TOKEN, fetch: due.fetch, maxCalls });
const go = (wanted: Wanted[], now = NOW, maxCalls = 40) => reconcile(client(maxCalls), wanted, NY, now);

beforeEach(() => {
  due = new FakeDue();
});

describe("Due diff and upsert, against a fake Due", () => {
  it("creates what's missing, with her offset, the esmeworld type and short notes", async () => {
    const report = await go([w("plan", "2026-11-16T09:00:00", "Plan your day")]);
    expect(report.done).toMatchObject({ created: 1, cancelled: 0, replaced: 0 });
    expect(due.mutations()).toEqual([
      {
        method: "POST", path: "/due/api/reminders", auth: `Bearer ${FAKE_DUE_TOKEN}`,
        body: { id: "esmeworld-2026-11-16-plan", title: "Plan your day", dueAt: "2026-11-16T09:00:00-05:00", notes: NOTES, type: "esmeworld" },
      },
    ]);
  });

  it("a replay changes nothing (only the one read)", async () => {
    const wanted = [w("plan", "2026-11-16T09:00:00"), w("review", "2026-11-16T21:00:00")];
    await go(wanted);
    due.calls = [];
    const again = await go(wanted);
    expect(again.done).toEqual({ cancelled: 0, created: 0, replaced: 0, rejected: 0 });
    expect(due.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("a reminder Due holds without an offset (US Eastern) at the same time is the same", async () => {
    due.seed({ id: "esmeworld-2026-11-16-plan", title: "T plan", dueAt: "2026-11-16T09:00:00" });
    expect((await go([w("plan", "2026-11-16T09:00:00")])).done.replaced).toBe(0);
    expect(due.mutations()).toEqual([]);
  });

  it("cancels what's no longer wanted (done means cancelled), and leaves other apps' reminders alone", async () => {
    due.seed({ id: "esmeworld-2026-11-16-due1-a" });
    due.seed({ id: "esmeworld-2026-11-15-plan" }); // yesterday's
    due.seed({ id: "oliver-thing", type: "manual" });
    const report = await go([]);
    expect(report.done.cancelled).toBe(2);
    expect(due.mutations().map((c) => `${c.method} ${c.path}`).sort()).toEqual([
      "DELETE /due/reminder/esmeworld-2026-11-15-plan",
      "DELETE /due/reminder/esmeworld-2026-11-16-due1-a",
    ]);
    expect(due.reminders.get("oliver-thing")!.deletedAt).toBeNull();
  });

  it("replaces one whose title or time changed (DELETE then POST)", async () => {
    due.seed({ id: "esmeworld-2026-11-16-plan", title: "Old words", dueAt: "2026-11-16T09:00:00-05:00" });
    const report = await go([w("plan", "2026-11-16T09:30:00", "Plan your day")]);
    expect(report.done.replaced).toBe(1);
    expect(due.mutations().map((c) => c.method)).toEqual(["DELETE", "POST"]);
    expect(due.active()[0]).toMatchObject({ title: "Plan your day", dueAt: "2026-11-16T09:30:00-05:00" });
  });

  it("400 already exists (Due's list was stale): delete and recreate", async () => {
    // Due holds it but didn't list it (e.g. it arrived between the read and the write).
    const realFetch = due.fetch;
    due.seed({ id: "esmeworld-2026-11-16-plan", title: "Stale" });
    due.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await realFetch(input, init);
      if (new Request(input, init).method === "GET") return Response.json({ state: { reminders: [] } });
      return res;
    }) as typeof fetch;
    const report = await go([w("plan", "2026-11-16T09:00:00", "Plan your day")]);
    expect(report.done.created).toBe(1);
    expect(due.mutations().map((c) => c.method)).toEqual(["POST", "DELETE", "POST"]);
    expect(due.active()[0]!.title).toBe("Plan your day");
  });

  it("never sends one whose alert time has passed (Due drops them)", async () => {
    const report = await go([w("plan", "2026-11-16T07:59:00"), w("now", "2026-11-16T08:00:00"), w("soon", "2026-11-16T08:01:00")]);
    expect(report.create.map((x) => x.id)).toEqual(["esmeworld-2026-11-16-soon"]);
    expect(due.mutations()).toHaveLength(1);
  });

  it("a past one already in Due and still wanted is kept, not replaced or cancelled", async () => {
    due.seed({ id: "esmeworld-2026-11-16-plan", title: "Old words", dueAt: "2026-11-16T07:00:00-05:00" });
    await go([w("plan", "2026-11-16T07:00:00", "New words")]);
    expect(due.mutations()).toEqual([]);
  });

  it("one she completed or deleted in Due is never brought back", async () => {
    due.seed({ id: "esmeworld-2026-11-16-plan", completedAt: "2026-11-16T12:00:00Z" });
    due.seed({ id: "esmeworld-2026-11-16-review", deletedAt: "2026-11-16T12:00:00Z" });
    await go([w("plan", "2026-11-16T09:00:00"), w("review", "2026-11-16T21:00:00")]);
    expect(due.mutations()).toEqual([]);
  });

  it("Due down: logs nothing sensitive, makes no more calls, and the next run retries", async () => {
    due.failWith = "down";
    const report = await go([w("plan", "2026-11-16T09:00:00")]);
    expect(report.stopped).toBe("due_unreachable");
    expect(due.calls).toHaveLength(1);
    due.failWith = null;
    expect((await go([w("plan", "2026-11-16T09:00:00")])).done.created).toBe(1);
  });

  it("a 5xx or a 401 mid-run stops the run (no storm)", async () => {
    due.failWith = 503;
    due.failOnly = ["POST"];
    const many = Array.from({ length: 5 }, (_, i) => w(`x${i}`, `2026-11-16T1${i}:00:00`));
    const report = await go(many);
    expect(report.stopped).toBe("due_server_error");
    expect(due.mutations()).toHaveLength(1);
    due.failWith = 401;
    due.calls = [];
    expect((await go(many)).stopped).toBe("due_unauthorized");
    expect(due.mutations()).toHaveLength(1);
  });

  it("a 4xx for one reminder is counted and the run goes on", async () => {
    const bad = { ...w("bad", "2026-11-16T09:00:00"), title: undefined as unknown as string };
    const report = await go([bad, w("good", "2026-11-16T10:00:00")]);
    expect(report.done).toMatchObject({ rejected: 1, created: 1 });
    expect(report.stopped).toBeUndefined();
  });

  it("never goes over the call budget; the rest waits for the next run", async () => {
    const many = Array.from({ length: 30 }, (_, i) => w(`m${String(i).padStart(2, "0")}`, `2026-11-16T${String(9 + Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 10).padStart(2, "0")}:00`));
    const first = await go(many, NOW, 10);
    expect(first.stopped).toBe("budget");
    expect(due.calls.length).toBeLessThanOrEqual(10);
    // Soonest first.
    expect(due.activeIds()[0]).toBe("esmeworld-2026-11-16-m00");
    for (let i = 0; i < 10 && due.activeIds().length < 30; i++) await go(many, NOW, 10);
    expect(due.activeIds()).toHaveLength(30);
  });

  it("planCalls is pure: the same inputs, the same plan", () => {
    const remote = [{ id: "esmeworld-2026-11-16-a", type: "esmeworld", title: "x", dueAt: "2026-11-16T09:00:00", completedAt: null, deletedAt: null }];
    const wanted = [w("b", "2026-11-16T10:00:00")];
    expect(planCalls(wanted, remote, NOW)).toEqual(planCalls(wanted, remote, NOW));
    expect(planCalls(wanted, remote, NOW)).toEqual({ cancel: ["esmeworld-2026-11-16-a"], create: wanted, replace: [] });
  });
});
