import { beforeEach, describe, expect, it } from "vitest";
import { DueClient, DueStop, FULL_PARSE_BYTES, describeShape, parseDueState } from "../../../src/due/client";
import { MAX_CANCELS_PER_KEY, MAX_REJECTIONS, NOTES, planCalls, reconcile, versionId, type CancelLog } from "../../../src/due/reconcile";
import type { Wanted } from "../../../src/due/rules";
import { FAKE_DUE_TOKEN, FAKE_DUE_URL, FakeDue } from "./fakeDue";

const NY = "America/New_York";
const at = (local: string) => Date.parse(`${local}-05:00`);
const NOW = at("2026-11-16T08:00:00");
const DAYS = ["20261115", "20261116", "20261117"];
/** The start of the first of DAYS in her zone: what the cron asks Due's list from. */
const FROM = "2026-11-15T00:00:00-05:00";
const w = (slot: string, local: string, title = `T ${slot}`): Wanted => ({ key: `esmeworld-20261116-${slot}`, kind: "plan", title, at: at(local) });

/** The cron's log of the ids it cancelled and sent, in memory, with the order of events. */
function memoryLog() {
  const cancelled = new Set<string>();
  const sent = new Map<string, number>();
  const events: string[] = [];
  const log: CancelLog = {
    cancelled,
    sent,
    record: async (ids) => {
      for (const id of ids) cancelled.add(id);
      events.push(`record ${ids.join(",")}`);
    },
    recordSent: async (list) => {
      for (const s of list) sent.set(s.id, s.at);
      events.push(`sent ${list.map((s) => s.id).join(",")}`);
    },
  };
  return { log, cancelled, sent, events };
}

let due: FakeDue;
let mem: ReturnType<typeof memoryLog>;
let clock: number;
const client = (maxCalls = 40, deadline?: number) =>
  new DueClient({ baseUrl: FAKE_DUE_URL, token: FAKE_DUE_TOKEN, fetch: due.fetch, maxCalls, deadline, clock: () => clock });
const go = (wanted: Wanted[], opts: { now?: number; maxCalls?: number; deadline?: number; timeZone?: string } = {}) =>
  reconcile(client(opts.maxCalls, opts.deadline), wanted, { timeZone: opts.timeZone ?? NY, now: opts.now ?? NOW, days: DAYS, from: FROM, log: mem.log });

beforeEach(() => {
  due = new FakeDue();
  mem = memoryLog();
  clock = 0;
});

describe("Due diff and upsert, against a fake Due", () => {
  it("creates what's missing under a versioned id, with the esmeworld type and short notes", async () => {
    const plan = w("plan", "2026-11-16T09:00:00", "Plan your day");
    const report = await go([plan]);
    expect(report.done).toMatchObject({ created: 1, cancelled: 0 });
    expect(versionId(plan)).toMatch(/^esmeworld-20261116-plan-v[0-9a-f]{8}$/);
    expect(due.mutations()).toEqual([
      {
        method: "POST", path: "/due/api/reminders", search: "", auth: `Bearer ${FAKE_DUE_TOKEN}`,
        // In Due's own zone (US Eastern) dueAt is plain local time, exactly as Due's doc shows it.
        body: { id: versionId(plan), title: "Plan your day", dueAt: "2026-11-16T09:00:00", notes: NOTES, type: "esmeworld" },
      },
    ]);
  });

  it("in another zone dueAt carries the offset", async () => {
    const plan = { ...w("plan", "2026-11-16T09:00:00"), at: Date.parse("2026-11-16T12:00:00-03:00") };
    await go([plan], { timeZone: "America/Sao_Paulo" });
    expect(due.mutations()[0]!.body!.dueAt).toBe("2026-11-16T12:00:00-03:00");
  });

  it("a replay changes nothing (only the one read)", async () => {
    const wanted = [w("plan", "2026-11-16T09:00:00"), w("review", "2026-11-16T21:00:00")];
    await go(wanted);
    due.calls = [];
    const again = await go(wanted);
    expect(again.done).toEqual({ cancelled: 0, created: 0, rejected: 0 });
    expect(due.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("Due echoing dueAt and the title in another form causes no churn (review I4)", async () => {
    due.echo = (r) => ({ ...r, dueAt: new Date(Date.parse(`${r.dueAt}-05:00`)).toISOString(), title: r.title.trim().toUpperCase() });
    const wanted = [w("plan", "2026-11-16T09:00:00", " Plan your day ")];
    await go(wanted);
    due.calls = [];
    await go(wanted);
    await go(wanted);
    expect(due.mutations()).toEqual([]);
  });

  it("cancels what's no longer wanted, logging it as ours BEFORE the DELETE, and leaves other apps alone", async () => {
    const a = w("d1-a", "2026-11-16T11:00:00");
    await go([a]);
    due.seed({ id: "oliver-thing", type: "manual" });
    const report = await go([]);
    expect(report.done.cancelled).toBe(1);
    expect(mem.events.at(-1)).toBe(`record ${versionId(a)}`);
    expect(due.mutations().at(-1)).toMatchObject({ method: "DELETE", path: `/due/reminder/${versionId(a)}` });
    expect(due.reminders.get("oliver-thing")!.deletedAt).toBeNull();
  });

  it("yesterday's active reminders are cancelled", async () => {
    due.seed({ id: "esmeworld-20261115-plan-v0000abcd" });
    await go([]);
    expect(due.activeIds()).toEqual([]);
  });

  it("a changed title or time: the new version first, then the old one goes", async () => {
    const before = w("plan", "2026-11-16T09:00:00", "Plan your day");
    await go([before]);
    const after = w("plan", "2026-11-16T09:30:00", "Plan your day");
    const report = await go([after]);
    expect(report.done).toMatchObject({ created: 1, cancelled: 1 });
    expect(due.mutations().slice(-2).map((c) => c.method)).toEqual(["POST", "DELETE"]);
    expect(due.activeIds()).toEqual([versionId(after)]);
  });

  describe("our own cancellations are not her dismissals (review I1)", () => {
    it("Due Off then On the same day: everything comes back", async () => {
      const wanted = [w("plan", "2026-11-16T09:00:00"), w("review", "2026-11-16T21:00:00")];
      await go(wanted);
      await go([]); // Off
      expect(due.activeIds()).toEqual([]);
      await go(wanted); // On again
      expect(due.activeIds()).toEqual(wanted.map((x) => `${versionId(x)}g2`).sort());
    });

    it("tick then untick: the reminder comes back", async () => {
      const a = w("d1-a", "2026-11-16T11:00:00");
      await go([a]);
      await go([]); // ticked
      await go([a]); // unticked
      expect(due.activeIds()).toEqual([`${versionId(a)}g2`]);
    });

    it("the cap shuffles an item out and back in", async () => {
      const eighth = w("d2-eighth", "2026-11-16T17:00:00");
      const urgent = w("d2-urgent", "2026-11-16T17:00:00");
      await go([eighth]);
      await go([urgent]); // a priority-1 to-do pushes it out
      await go([eighth]); // the priority-1 one is done: back in
      expect(due.activeIds()).toEqual([`${versionId(eighth)}g2`]);
    });

    it("a 503 between a replacement's POST and the old one's DELETE loses nothing", async () => {
      const before = w("plan", "2026-11-16T09:00:00", "Old words");
      await go([before]);
      const after = w("plan", "2026-11-16T09:00:00", "New words");
      due.failWith = 503;
      due.failOnly = ["DELETE"];
      const report = await go([after]);
      expect(report.stopped).toBe("due_server_error");
      expect(due.activeIds().sort()).toEqual([versionId(after), versionId(before)].sort());
      due.failWith = null;
      await go([after]);
      expect(due.activeIds()).toEqual([versionId(after)]);
    });

    it("a 503 on the POST of a replacement keeps the old one active", async () => {
      const before = w("plan", "2026-11-16T09:00:00", "Old words");
      await go([before]);
      due.failWith = 503;
      due.failOnly = ["POST"];
      await go([w("plan", "2026-11-16T09:00:00", "New words")]);
      expect(due.activeIds()).toEqual([versionId(before)]);
    });

    it("one she completed in Due is never brought back that day, even in a new version", async () => {
      const plan = w("plan", "2026-11-16T09:00:00");
      await go([plan]);
      due.reminders.get(versionId(plan))!.completedAt = "2026-11-16T14:00:00Z";
      due.calls = [];
      await go([plan]);
      await go([w("plan", "2026-11-16T09:30:00", "Changed")]);
      expect(due.mutations()).toEqual([]);
    });

    it("one she deleted in Due herself (not in our log) is not brought back", async () => {
      const plan = w("plan", "2026-11-16T09:00:00");
      await go([plan]);
      due.reminders.get(versionId(plan))!.deletedAt = "2026-11-16T14:00:00Z";
      due.calls = [];
      await go([plan]);
      expect(due.mutations()).toEqual([]);
    });

    it(`stops flapping: after ${MAX_CANCELS_PER_KEY} of our own cancellations a reminder is left alone that day`, async () => {
      const a = w("d1-a", "2026-11-16T11:00:00");
      for (let i = 0; i < 6; i++) {
        await go([a]);
        await go([]);
      }
      const posts = due.mutations().filter((c) => c.method === "POST");
      expect(posts).toHaveLength(MAX_CANCELS_PER_KEY);
    });
  });

  it("never sends one whose alert time has passed (Due drops them)", async () => {
    const report = await go([w("a", "2026-11-16T07:59:00"), w("b", "2026-11-16T08:00:00"), w("c", "2026-11-16T08:01:00")]);
    expect(report.create.map((x) => x.key)).toEqual(["esmeworld-20261116-c"]);
  });

  it("a late timed to-do goes at its sendAt, under the version of its real time", async () => {
    const t: Wanted = { ...w("t-x", "2026-11-16T07:55:00"), kind: "timed", sendAt: NOW + 60_000 };
    await go([t]);
    expect(due.mutations()[0]!.body).toMatchObject({ id: versionId(t), dueAt: "2026-11-16T08:01:00" });
    due.calls = [];
    await go([{ ...t, sendAt: NOW + 120_000 }], { now: NOW + 60_000 });
    expect(due.mutations()).toEqual([]);
  });

  it("a past one already in Due and still wanted is kept, even when its words changed", async () => {
    const old = w("plan", "2026-11-16T07:00:00", "Old words");
    await go([old], { now: at("2026-11-16T06:00:00") });
    due.calls = [];
    await go([w("plan", "2026-11-16T07:00:00", "New words")]);
    expect(due.mutations()).toEqual([]);
  });

  it("400 already exists means that version is there: nothing more", async () => {
    const plan = w("plan", "2026-11-16T09:00:00");
    due.seed({ id: versionId(plan) });
    const realFetch = due.fetch;
    due.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new Request(input, init).method === "GET") return Response.json({ reminders: [] });
      return realFetch(input, init);
    }) as typeof fetch;
    const report = await go([plan]);
    expect(report.done).toMatchObject({ created: 1, rejected: 0 });
    expect(due.mutations().map((c) => c.method)).toEqual(["POST"]);
  });

  it("Due refusing offsets: the run stops after a few refusals (review I4)", async () => {
    due.refuse = (b) => /[+-]\d{2}:\d{2}$/.test(String(b.dueAt));
    const many = Array.from({ length: 10 }, (_, i) => ({ ...w(`x${i}`, `2026-11-16T1${i}:00:00`), at: Date.parse(`2026-11-16T1${i}:00:00-03:00`) }));
    const report = await go(many, { timeZone: "America/Sao_Paulo" });
    expect(report.stopped).toBe("due_rejecting");
    expect(due.mutations()).toHaveLength(MAX_REJECTIONS);
  });

  it("Due down: one call, then the next run retries", async () => {
    due.failWith = "down";
    expect((await go([w("plan", "2026-11-16T09:00:00")])).stopped).toBe("due_unreachable");
    expect(due.calls).toHaveLength(1);
    due.failWith = null;
    expect((await go([w("plan", "2026-11-16T09:00:00")])).done.created).toBe(1);
  });

  it("a 5xx or a 401 mid-run stops the run", async () => {
    due.failWith = 503;
    due.failOnly = ["POST"];
    const many = Array.from({ length: 5 }, (_, i) => w(`x${i}`, `2026-11-16T1${i}:00:00`));
    expect((await go(many)).stopped).toBe("due_server_error");
    expect(due.mutations()).toHaveLength(1);
    due.failWith = 401;
    due.calls = [];
    expect((await go(many)).stopped).toBe("due_unauthorized");
    expect(due.mutations()).toHaveLength(1);
  });

  it("never goes over the call budget; the rest waits for the next run", async () => {
    const many = Array.from({ length: 30 }, (_, i) => w(`m${String(i).padStart(2, "0")}`, `2026-11-16T${String(9 + Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 10).padStart(2, "0")}:00`));
    const first = await go(many, { maxCalls: 10 });
    expect(first.stopped).toBe("budget");
    expect(due.calls.length).toBeLessThanOrEqual(10);
    for (let i = 0; i < 10 && due.activeIds().length < 30; i++) await go(many, { maxCalls: 10 });
    expect(due.activeIds()).toHaveLength(30);
  });

  it("stops at the run's deadline: no call starts that could end after it (review I2)", async () => {
    due.onCall = () => (clock += 4_000); // a slow Due: 4 s a call
    const many = Array.from({ length: 20 }, (_, i) => w(`s${i}`, `2026-11-16T1${i % 10}:0${Math.floor(i / 10)}:00`));
    const report = await go(many, { deadline: 20_000 });
    expect(report.stopped).toBe("deadline");
    // Each call may take up to 5 s: started only while 5 s remain.
    expect(due.calls.length).toBe(4);
    expect(clock).toBeLessThanOrEqual(20_000);
  });

  it("planCalls is pure", () => {
    const remote = [{ id: "esmeworld-20261116-a-v00000000", type: "esmeworld", title: "x", dueAt: "2026-11-16T09:00:00", completedAt: null, deletedAt: null }];
    const wanted = [w("b", "2026-11-16T10:00:00")];
    expect(planCalls(wanted, remote, new Set(), NOW)).toEqual(planCalls(wanted, remote, new Set(), NOW));
    expect(planCalls(wanted, remote, new Set(), NOW)).toMatchObject({ cancel: ["esmeworld-20261116-a-v00000000"], create: [{ key: "esmeworld-20261116-b" }] });
  });
});

describe("reading Due's state (review I3)", () => {
  const ours = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: "T", dueAt: "2026-11-16T09:00:00", type: "esmeworld", completedAt: null, deletedAt: null, ...extra });
  const old = (i: number) => ours(`esmeworld-2026${String(1 + (i % 9)).padStart(2, "0")}01-d1-x${i}-v0000abcd`, { deletedAt: "2026-01-01T00:00:00Z" });

  it("a large state: only our reminders of the days asked for are read, found by their ids", () => {
    const wanted = [
      ours("esmeworld-20261116-plan-v1234abcd", { title: 'Has {braces} and "quotes" \\ and }' }),
      ours("esmeworld-20261115-review-v1234abcd"),
      ours("esmeworld-20261117-t-y-v1234abcd", { completedAt: "x" }),
    ];
    const filler = [...Array.from({ length: 3000 }, (_, i) => old(i)), { id: "esmeworld-20261116-other", type: "manual" }];
    const text = JSON.stringify({ state: { reminders: [...filler.slice(0, 1500), ...wanted, ...filler.slice(1500)] } });
    expect(text.length).toBeGreaterThan(FULL_PARSE_BYTES);
    const got = parseDueState(text, DAYS);
    expect(got.map((r) => r.id).sort()).toEqual(wanted.map((r) => r.id).sort());
    expect(got.find((r) => r.id.includes("plan"))!.title).toBe('Has {braces} and "quotes" \\ and }');
  });

  it("a small state is parsed whole, with the same answer", () => {
    const text = JSON.stringify({ state: { reminders: [ours("esmeworld-20261116-plan-v1234abcd"), old(1), { id: "x", type: "manual" }] } });
    expect(parseDueState(text, DAYS).map((r) => r.id)).toEqual(["esmeworld-20261116-plan-v1234abcd"]);
  });

  it("a state too large is refused (the run stops) rather than parsed", async () => {
    due.filler = Array.from({ length: 30_000 }, (_, i) => old(i)); // about 4 MB
    const tiny = new DueClient({ baseUrl: FAKE_DUE_URL, token: FAKE_DUE_TOKEN, fetch: due.fetch, maxCalls: 5 });
    expect((await tiny.reminders(DAYS, FROM)).length).toBe(0);
    due.filler = Array.from({ length: 70_000 }, (_, i) => old(i)); // about 9 MB
    await expect(tiny.reminders(DAYS, FROM)).rejects.toMatchObject({ code: "due_state_too_large" });
  });
});

describe("Oliver's filtered endpoint (18 Nov)", () => {
  const list = (maxCalls = 5) => new DueClient({ baseUrl: FAKE_DUE_URL, token: FAKE_DUE_TOKEN, fetch: due.fetch, maxCalls });
  const stopOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (error) {
      if (error instanceof DueStop) return error;
      throw error;
    }
    throw new Error("expected a stop");
  };

  it("reads GET /due/api/reminders?type=esmeworld&from=<her start of yesterday>, never /api/state", async () => {
    await go([w("plan", "2026-11-16T09:00:00")]);
    const gets = due.calls.filter((c) => c.method === "GET");
    expect(gets).toHaveLength(1);
    expect(gets[0]!.path).toBe("/due/api/reminders");
    const q = new URLSearchParams(gets[0]!.search);
    expect(q.get("type")).toBe("esmeworld");
    expect(q.get("from")).toBe(FROM);
  });

  it("a + offset is sent encoded (a bare + would reach Due as a space)", async () => {
    await list().reminders(DAYS, "2026-11-15T00:00:00+01:00");
    expect(due.calls[0]!.search).toBe("?type=esmeworld&from=2026-11-15T00%3A00%3A00%2B01%3A00");
    expect(new URLSearchParams(due.calls[0]!.search).get("from")).toBe("2026-11-15T00:00:00+01:00");
  });

  it("an empty list is fine: nothing of ours in Due, so today's are created", async () => {
    due.listBody = { reminders: [] };
    expect(await list().reminders(DAYS, FROM)).toEqual([]);
    due.listBody = undefined;
    const report = await go([w("plan", "2026-11-16T09:00:00")]);
    expect(report.stopped).toBeUndefined();
    expect(report.done.created).toBe(1);
  });

  it("works with exactly the endpoint's fields (no notes): a replay changes nothing", async () => {
    const wanted = [w("plan", "2026-11-16T09:00:00"), w("d1-a", "2026-11-16T11:00:00")];
    await go(wanted);
    due.calls = [];
    expect((await list().reminders(DAYS, FROM)).every((r) => !("notes" in r))).toBe(true);
    due.calls = [];
    expect((await go(wanted)).done).toEqual({ cancelled: 0, created: 0, rejected: 0 });
    expect(due.mutations()).toEqual([]);
  });

  it("no reminders array: the run stops, nothing is created or cancelled, and the stop says status and shape", async () => {
    due.seed({ id: "esmeworld-20261116-d1-old-v0000abcd" });
    due.listBody = { state: { reminders: {} }, ok: true };
    const report = await go([w("plan", "2026-11-16T09:00:00")]);
    expect(report).toMatchObject({ stopped: "due_bad_state", stoppedStatus: 200, stoppedShape: "{state:{reminders:object},ok:boolean}" });
    expect(due.mutations()).toEqual([]);
    expect(due.activeIds()).toEqual(["esmeworld-20261116-d1-old-v0000abcd"]);
  });

  it("reminders that isn't an array, or a bare array, is a bad state too", async () => {
    due.listBody = { reminders: "x" };
    expect(await stopOf(list().reminders(DAYS, FROM))).toMatchObject({ code: "due_bad_state", status: 200, shape: "{reminders:string}" });
    due.listBody = [];
    expect(await stopOf(list().reminders(DAYS, FROM))).toMatchObject({ code: "due_bad_state", shape: "array" });
  });

  it("a body that isn't JSON (a login page): shape not_json with its content type, never the text", async () => {
    due.listBody = "<html>Secret page</html>";
    const stop = await stopOf(list().reminders(DAYS, FROM));
    expect(stop).toMatchObject({ code: "due_bad_state", status: 200, shape: "not_json(text/html)" });
    expect(JSON.stringify(stop)).not.toContain("Secret");
  });

  it("a non-2xx answer (404: endpoint not there) stops with its status and no shape; nothing changes", async () => {
    due.seed({ id: "esmeworld-20261116-d1-old-v0000abcd" });
    due.failWith = 404;
    const report = await go([w("plan", "2026-11-16T09:00:00")]);
    expect(report).toMatchObject({ stopped: "due_bad_state", stoppedStatus: 404 });
    expect(report.stoppedShape).toBeUndefined();
    expect(due.calls).toHaveLength(1);
    expect(due.activeIds()).toEqual(["esmeworld-20261116-d1-old-v0000abcd"]);
  });

  it("the shape names keys and types only: never values, and never a key that could be a title", () => {
    const text = JSON.stringify({ "Buy milk for Oliver": "private", data: { inner: "secret value", n: 3, list: [1] }, x: null });
    const shape = describeShape(text, "application/json");
    expect(shape).toBe("{data:{inner:string,n:number,list:array},x:null,+1}");
    expect(shape).not.toMatch(/milk|private|secret/);
    expect(describeShape("", null)).toBe("empty");
    expect(describeShape("nope", "text/html; charset=utf-8")).toBe("not_json(text/html)");
    expect(describeShape("nope", "weird type with spaces")).toBe("not_json");
    expect(describeShape(JSON.stringify(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, i]))), null)).toMatch(/,\+4}$/);
  });

  describe("if the endpoint leaves out completed and deleted reminders", () => {
    beforeEach(() => {
      due.omitDismissed = true;
    });

    it("one she completed is not brought back (we know we sent it)", async () => {
      const plan = w("plan", "2026-11-16T09:00:00");
      await go([plan]);
      due.reminders.get(versionId(plan))!.completedAt = "2026-11-16T14:00:00Z";
      due.calls = [];
      await go([plan]);
      await go([w("plan", "2026-11-16T09:30:00", "Changed")]);
      expect(due.mutations()).toEqual([]);
    });

    it("one she deleted is not brought back", async () => {
      const plan = w("plan", "2026-11-16T09:00:00");
      await go([plan]);
      due.reminders.get(versionId(plan))!.deletedAt = "2026-11-16T14:00:00Z";
      due.calls = [];
      await go([plan]);
      expect(due.mutations()).toEqual([]);
      expect(due.activeIds()).toEqual([]);
    });

    it("Off then On: ours come back under a new id (never re-sent under the cancelled one)", async () => {
      const wanted = [w("plan", "2026-11-16T09:00:00"), w("review", "2026-11-16T21:00:00")];
      await go(wanted);
      await go([]);
      await go(wanted);
      expect(due.activeIds()).toEqual(wanted.map((x) => `${versionId(x)}g2`).sort());
    });

    it(`still stops flapping after ${MAX_CANCELS_PER_KEY} of our own cancellations`, async () => {
      const a = w("d1-a", "2026-11-16T11:00:00");
      for (let i = 0; i < 6; i++) {
        await go([a]);
        await go([]);
      }
      expect(due.mutations().filter((c) => c.method === "POST")).toHaveLength(MAX_CANCELS_PER_KEY);
    });

    it("a sent one that has already gone off and isn't listed doesn't block a new time later that day", async () => {
      const early = w("t-x", "2026-11-16T09:00:00");
      await go([early], { now: at("2026-11-16T08:00:00") });
      due.reminders.delete(versionId(early)); // went off; not listed any more
      const later = w("t-x", "2026-11-16T15:00:00");
      await go([later], { now: at("2026-11-16T10:00:00") });
      expect(due.activeIds()).toEqual([versionId(later)]);
    });
  });

  it("logs what it sent with when it goes off, after the POSTs (only those Due took)", async () => {
    due.refuse = (b) => String(b.id).includes("-bad-");
    const good = w("good", "2026-11-16T09:00:00");
    const report = await go([good, w("bad", "2026-11-16T10:00:00")]);
    expect(report.done).toMatchObject({ created: 1, rejected: 1 });
    expect([...mem.sent]).toEqual([[versionId(good), good.at]]);
  });
});
