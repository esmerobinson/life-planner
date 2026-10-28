import Dexie from "dexie";
import { vi } from "vitest";
import { HubDB } from "../data/db";
import { applyUntracked } from "../data/changeTracking";
import type { Item } from "../domain/types";
import { FakeSyncServer } from "./fakeServer";
import {
  FUTURE_RESTAMP_MS, MAX_CHANGES_PER_REQUEST, MAX_REQUEST_BYTES, NEEDS_PASSPHRASE_MESSAGE,
  getDeviceId, getMeta, saveSyncSettings, setMeta, syncOnce,
} from "./engine";

const TOKEN = "c0ffee".padEnd(64, "0"); // fake, never a real token
const SERVER = "https://sync.example.test/";

let clock = 1_800_000_000_000;
let n = 0;
const open: HubDB[] = [];

beforeEach(() => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function device(): Promise<HubDB> {
  const d = new HubDB(`sync-device-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

const item = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: `T ${id}`, links: [], areaId: "art", priority: 2,
  status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01", ...extra,
});

const titles = async (d: HubDB) =>
  Object.fromEntries((await d.items.toArray()).map((i) => [i.id, i.title]));

describe("syncOnce", () => {
  it("does nothing without a token or address", async () => {
    const d = new HubDB(`sync-device-${++n}`);
    open.push(d);
    const fetch = vi.fn();
    expect(await syncOnce({ db: d, fetch })).toEqual({ kind: "not-configured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the bearer token and a stable random deviceId", async () => {
    const d = await device();
    const server = new FakeSyncServer(TOKEN);
    await syncOnce({ db: d, fetch: server.fetch });
    const [req] = server.syncRequests;
    expect(req!.authorization).toBe(`Bearer ${TOKEN}`);
    expect(req!.body!.deviceId).toBe(await getDeviceId(d));
    expect(req!.body!.deviceId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    const other = await device();
    expect(await getDeviceId(other)).not.toBe(await getDeviceId(d));
  });

  it("first sync uploads everything pending in batches of at most 500 and clears pending", async () => {
    const d = await device();
    await d.items.bulkAdd(Array.from({ length: 1201 }, (_, i) => item(`i${String(i).padStart(4, "0")}`)));
    const server = new FakeSyncServer(TOKEN);
    const out = await syncOnce({ db: d, fetch: server.fetch });
    expect(out).toMatchObject({ kind: "ok", sent: 1201 });
    const sizes = server.syncRequests.map((r) => r.body!.changes.length);
    expect(sizes).toEqual([500, 500, 201]);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MAX_CHANGES_PER_REQUEST);
    expect(server.rows.size).toBe(1201);
    expect(await d.pending.count()).toBe(0);
    // The synced data carries its own id and updatedAt.
    const first = server.syncRequests[0]!.body!.changes[0]!;
    expect(first.data).toMatchObject({ id: first.id, updatedAt: first.updatedAt });
  });

  it("keeps every request under 1 MB of JSON", async () => {
    const d = await device();
    const big = "x".repeat(150_000);
    await d.items.bulkAdd(Array.from({ length: 20 }, (_, i) => item(`big${i}`, { notes: big })));
    const server = new FakeSyncServer(TOKEN);
    expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("ok");
    expect(server.syncRequests.length).toBeGreaterThan(2);
    for (const r of server.syncRequests) expect(r.bodyBytes).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
    expect(server.rows.size).toBe(20);
  });

  it("a single row too large for one request stays pending and does not block the others", async () => {
    const d = await device();
    await d.items.add(item("huge", { notes: "x".repeat(MAX_REQUEST_BYTES) }));
    await d.items.add(item("small"));
    const server = new FakeSyncServer(TOKEN);
    const out = await syncOnce({ db: d, fetch: server.fetch });
    expect(out).toMatchObject({ kind: "ok", sent: 1, held: 1 });
    expect(server.data("items", "small")).toBeDefined();
    expect(server.data("items", "huge")).toBeUndefined();
    for (const r of server.syncRequests) expect(r.bodyBytes).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
    expect((await d.pending.toArray()).map((p) => p.id)).toEqual(["huge"]);
  });

  it("two devices converge, and a conflicting edit goes to the later updatedAt on both", async () => {
    const server = new FakeSyncServer(TOKEN);
    const a = await device();
    const b = await device();
    await a.items.bulkAdd([item("shared"), item("onlyA")]);
    await b.items.add(item("onlyB"));
    await syncOnce({ db: a, fetch: server.fetch });
    await syncOnce({ db: b, fetch: server.fetch });
    await syncOnce({ db: a, fetch: server.fetch });
    expect(await titles(a)).toEqual(await titles(b));
    expect(Object.keys(await titles(a)).sort()).toEqual(["onlyA", "onlyB", "shared"]);

    // Both edit "shared" offline; B's edit is later.
    clock += 1000;
    await a.items.update("shared", { title: "from A" });
    clock += 1000;
    await b.items.update("shared", { title: "from B" });
    await syncOnce({ db: a, fetch: server.fetch }); // A's edit reaches the server first
    await syncOnce({ db: b, fetch: server.fetch }); // B's later edit wins
    await syncOnce({ db: a, fetch: server.fetch }); // A learns the winner
    expect((await a.items.get("shared"))!.title).toBe("from B");
    expect((await b.items.get("shared"))!.title).toBe("from B");
    expect(await titles(a)).toEqual(await titles(b));
    expect(await a.pending.count()).toBe(0);
    expect(await b.pending.count()).toBe(0);
  });

  it("an older offline edit loses to the newer server row and the device takes the winner", async () => {
    const server = new FakeSyncServer(TOKEN);
    const a = await device();
    const b = await device();
    await a.items.add(item("x", { title: "A old" }));
    await syncOnce({ db: a, fetch: server.fetch });
    await syncOnce({ db: b, fetch: server.fetch });
    clock += 10_000;
    await b.items.update("x", { title: "B newer" });
    await syncOnce({ db: b, fetch: server.fetch });
    clock -= 5_000; // A's clock is behind: its edit is older than B's
    await a.items.update("x", { title: "A older edit" });
    const before = server.syncRequests.length;
    await syncOnce({ db: a, fetch: server.fetch });
    const reply = server.syncRequests[before]!.response as { changes: { id: string; data: { title: string } }[] };
    expect(reply.changes.map((c) => c.data.title)).toEqual(["B newer"]);
    expect((await a.items.get("x"))!.title).toBe("B newer");
    expect(await a.pending.count()).toBe(0);
  });

  it("a local edit made during a request is not overwritten by the response and is sent next time", async () => {
    const server = new FakeSyncServer(TOKEN);
    const a = await device();
    const b = await device();
    await a.items.bulkAdd([item("x", { title: "start" }), item("y")]);
    await syncOnce({ db: a, fetch: server.fetch });
    await syncOnce({ db: b, fetch: server.fetch });
    clock += 1_000;
    await b.items.update("x", { title: "B edit" });
    await syncOnce({ db: b, fetch: server.fetch });

    // A sends an unrelated change; while that request is in flight A edits x (later than B).
    clock += 1_000;
    await a.items.update("y", { title: "y2" });
    let edited = false;
    const editDuringRequest: typeof fetch = async (input, init) => {
      if (!edited) {
        edited = true;
        clock += 1_000;
        await a.items.update("x", { title: "A during request" });
      }
      return server.fetch(input, init);
    };
    const before = server.syncRequests.length;
    await syncOnce({ db: a, fetch: editDuringRequest });
    const [first, second] = server.syncRequests.slice(before) as unknown as {
      body: { cursor: number; changes: { data: { title: string } }[] };
      response: { changes: { data: { title: string } }[] };
    }[];
    // The first response carried B's (older) x while A's newer edit was waiting: it was not
    // applied over it, and the edit was sent in the next request.
    expect(first!.body.changes.map((c) => c.data.title)).toEqual(["y2"]);
    expect(first!.response.changes.map((c) => c.data.title)).toContain("B edit");
    expect(second!.body.changes.map((c) => c.data.title)).toEqual(["A during request"]);
    expect((await a.items.get("x"))!.title).toBe("A during request");
    expect(server.data("items", "x")!.title).toBe("A during request");
    expect(await a.pending.count()).toBe(0);
    await syncOnce({ db: b, fetch: server.fetch });
    expect(await titles(b)).toEqual(await titles(a));
  });

  it("an unsent local change OLDER than a row in the response gives way to it (v1.1 F.3)", async () => {
    const server = new FakeSyncServer(TOKEN);
    const a = await device();
    const b = await device();
    await a.items.add(item("x", { title: "start" }));
    await syncOnce({ db: a, fetch: server.fetch });
    await syncOnce({ db: b, fetch: server.fetch });
    clock += 10_000;
    await b.items.update("x", { title: "B (newest)" });
    await syncOnce({ db: b, fetch: server.fetch });
    clock -= 8_000; // A's clock is behind
    let edited = false;
    const editDuringRequest: typeof fetch = async (input, init) => {
      if (!edited) {
        edited = true;
        await a.items.update("x", { title: "A during request" });
      }
      return server.fetch(input, init);
    };
    await syncOnce({ db: a, fetch: editDuringRequest });
    expect((await a.items.get("x"))!.title).toBe("B (newest)");
    expect(await a.pending.count()).toBe(0);
    // It lost on arrival, so it was never sent.
    const sentTitles = server.syncRequests.flatMap((r) => r.body!.changes.map((c) => c.data.title));
    expect(sentTitles).not.toContain("A during request");
  });

  it("a device that loses a tie learns the winner from a returned winner", async () => {
    const server = new FakeSyncServer(TOKEN);
    const a = await device();
    const b = await device();
    await setMeta(a, "deviceId", "device-aaaaaaaaaaaaaaaa");
    await setMeta(b, "deviceId", "device-bbbbbbbbbbbbbbbb"); // greater: wins a tie
    await a.items.add(item("seed"));
    await syncOnce({ db: a, fetch: server.fetch });
    await syncOnce({ db: b, fetch: server.fetch });

    // Both write x at the same millisecond. B syncs first.
    clock += 5_000;
    await b.items.add(item("x", { title: "from B" }));
    await syncOnce({ db: b, fetch: server.fetch });
    // A's write happens while A's pull is in flight, so A keeps it (a tie stays pending for
    // the server to decide) and its cursor moves past B's row.
    let edited = false;
    const editDuringRequest: typeof fetch = async (input, init) => {
      if (!edited) {
        edited = true;
        await a.items.add(item("x", { title: "from A" }));
      }
      return server.fetch(input, init);
    };
    const before = server.syncRequests.length;
    await syncOnce({ db: a, fetch: editDuringRequest });
    const [first, second] = server.syncRequests.slice(before) as unknown as {
      body: { cursor: number; changes: { data: { title: string } }[] };
      response: { applied: number; ignored: number; cursor: number; changes: { data: { title: string } }[] };
    }[];
    // The pull carried B's x; A's tied write stayed pending (the server decides a tie)...
    expect(first!.response.changes.map((c) => c.data.title)).toEqual(["from B"]);
    // ...and was sent next, with a cursor already past B's row, so B's row came back only
    // as a RETURNED WINNER.
    expect(second!.body.changes.map((c) => c.data.title)).toEqual(["from A"]);
    expect(second!.body.cursor).toBe(first!.response.cursor);
    expect(second!.body.cursor).toBe(server.seq);
    expect(second!.response).toMatchObject({ applied: 0, ignored: 1 });
    expect(second!.response.changes.map((c) => c.data.title)).toEqual(["from B"]);
    expect((await a.items.get("x"))!.title).toBe("from B");
    expect(await a.pending.count()).toBe(0);
  });

  it("replaying the same request and the same response is harmless", async () => {
    const server = new FakeSyncServer(TOKEN);
    const a = await device();
    const b = await device();
    await b.items.bulkAdd([item("p"), item("q")]);
    await syncOnce({ db: b, fetch: server.fetch });
    await a.items.add(item("mine"));
    let recorded: { body: string; response: string } | null = null;
    const recording: typeof fetch = async (input, init) => {
      const res = await server.fetch(input, init);
      const text = await res.clone().text();
      recorded ??= { body: init!.body as string, response: text };
      return res;
    };
    await syncOnce({ db: a, fetch: recording });
    const rowsBefore = await a.items.orderBy("id").toArray();
    const cursorBefore = await getMeta(a, "cursor");
    const serverBefore = JSON.stringify([...server.rows.values()]);

    // The server sees the same request again: nothing changes there.
    const again = await server.fetch(`${SERVER}v1/sync`, {
      method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: recorded!.body,
    });
    expect(await again.json()).toMatchObject({ applied: 0 });
    expect(JSON.stringify([...server.rows.values()])).toBe(serverBefore);

    // The device gets the same response again: nothing changes here.
    const replay: typeof fetch = async () => new Response(recorded!.response, { status: 200 });
    expect((await syncOnce({ db: a, fetch: replay })).kind).toBe("ok");
    expect(await a.items.orderBy("id").toArray()).toEqual(rowsBefore);
    expect(await getMeta(a, "cursor")).toBe(cursorBefore);
    expect(await a.pending.count()).toBe(0);
  });

  it("keeps asking while hasMore and pulls everything", async () => {
    const server = new FakeSyncServer(TOKEN, { pageSize: 7 });
    const b = await device();
    await b.items.bulkAdd(Array.from({ length: 50 }, (_, i) => item(`r${i}`)));
    await syncOnce({ db: b, fetch: server.fetch });
    const a = await device();
    const before = server.syncRequests.length;
    expect((await syncOnce({ db: a, fetch: server.fetch })).kind).toBe("ok");
    expect(await a.items.count()).toBe(50);
    expect(server.syncRequests.length - before).toBe(8);
    expect(await getMeta(a, "cursor")).toBe(server.seq);
    expect(await a.pending.count()).toBe(0); // pulled rows are not sent back
  });

  it("401 stops: clears the token, asks for the passphrase, and never retries by itself", async () => {
    const server = new FakeSyncServer(TOKEN);
    const a = await device();
    await a.items.add(item("x"));
    server.inject({ status: 401, body: { error: "unauthorized" } });
    const out = await syncOnce({ db: a, fetch: server.fetch });
    expect(out).toEqual({ kind: "needs-passphrase", message: NEEDS_PASSPHRASE_MESSAGE });
    expect(server.requests).toHaveLength(1);
    expect(await getMeta(a, "token")).toBeUndefined();
    expect(await getMeta(a, "needsPassphrase")).toBe(true);
    expect(await a.pending.count()).toBe(1);
    expect(await syncOnce({ db: a, fetch: server.fetch })).toEqual({ kind: "not-configured" });
    expect(server.requests).toHaveLength(1);
  });

  it("a 401 for an OLD token never deletes a token saved while that run was in flight", async () => {
    const server = new FakeSyncServer(TOKEN);
    const a = await device();
    await setMeta(a, "token", "0".repeat(64)); // a wrong token, in use by the run below
    const NEW = "1".padEnd(64, "2");
    const saveDuringRequest: typeof fetch = async (input, init) => {
      await saveSyncSettings(a, { serverUrl: SERVER, token: NEW }); // Esme saves the right one
      return server.fetch(input, init); // ...but this request carried the old one: 401
    };
    const out = await syncOnce({ db: a, fetch: saveDuringRequest });
    expect(out.kind).not.toBe("needs-passphrase");
    expect(await getMeta(a, "token")).toBe(NEW);
    expect(await getMeta(a, "needsPassphrase")).toBeUndefined();
  });

  it("429 reports how long to wait from Retry-After and keeps everything pending", async () => {
    const server = new FakeSyncServer(TOKEN);
    const a = await device();
    await a.items.add(item("x"));
    server.inject({ status: 429, body: { error: "rate_limited" }, headers: { "Retry-After": "120" } });
    const out = await syncOnce({ db: a, fetch: server.fetch });
    expect(out).toMatchObject({ kind: "rate-limited", retryAfterMs: 120_000 });
    expect(server.requests).toHaveLength(1);
    expect(await a.pending.count()).toBe(1);
  });

  it("changing the sync address starts over: cursor 0, every row pending again, both sides complete", async () => {
    const scratch = new FakeSyncServer(TOKEN);
    const a = await device();
    await a.items.bulkAdd([item("mine1"), item("mine2")]);
    await syncOnce({ db: a, fetch: scratch.fetch });
    expect(await a.pending.count()).toBe(0);
    expect(await getMeta(a, "firstPullDone")).toBe(true);

    // The real server already holds MORE rows than this device's cursor (no 409 would fire).
    const real = new FakeSyncServer(TOKEN);
    const other = new HubDB(`sync-device-${++n}`);
    open.push(other);
    await saveSyncSettings(other, { serverUrl: "https://real.example.test", token: TOKEN });
    await other.items.bulkAdd([item("theirs1"), item("theirs2"), item("theirs3")]);
    await syncOnce({ db: other, fetch: real.fetch });
    expect(real.seq).toBeGreaterThan((await getMeta<number>(a, "cursor"))!);

    await saveSyncSettings(a, { serverUrl: "https://real.example.test/", token: TOKEN });
    expect(await getMeta(a, "cursor")).toBe(0);
    expect(await getMeta(a, "lastSyncedAt")).toBeUndefined();
    expect(await getMeta(a, "firstPullDone")).toBeUndefined();
    expect(await a.pending.count()).toBe(2);
    await syncOnce({ db: a, fetch: real.fetch });
    expect(Object.keys(await titles(a)).sort()).toEqual(["mine1", "mine2", "theirs1", "theirs2", "theirs3"]);
    expect(real.rows.size).toBe(5);

    // Saving the same address again (e.g. a new passphrase) does not start over.
    await saveSyncSettings(a, { serverUrl: "https://real.example.test", token: TOKEN });
    expect(await getMeta(a, "cursor")).toBe(real.seq);
    expect(await a.pending.count()).toBe(0);
  });

  it("409 cursor_ahead resets the cursor to 0 and re-sends every local row unchanged", async () => {
    const old = new FakeSyncServer(TOKEN);
    const a = await device();
    await a.items.bulkAdd([item("p"), item("q")]);
    await a.goals.add({ id: "g", title: "G", areaId: "art", kind: "practice", milestones: [], createdAt: "2026-10-01" });
    await syncOnce({ db: a, fetch: old.fetch });
    expect(await getMeta(a, "cursor")).toBe(3);
    const stamps = (await a.items.toArray()).map((i) => i.updatedAt);

    const fresh = new FakeSyncServer(TOKEN); // e.g. the server was rebuilt: its seq is 0
    const out = await syncOnce({ db: a, fetch: fresh.fetch });
    expect(out.kind).toBe("ok");
    expect(fresh.syncRequests[0]!.status).toBe(409);
    expect(fresh.syncRequests[1]!.body!.cursor).toBe(0);
    expect(fresh.rows.size).toBe(3);
    expect((await a.items.toArray()).map((i) => i.updatedAt)).toEqual(stamps);
    expect(await getMeta(a, "cursor")).toBe(fresh.seq);
    expect(await a.pending.count()).toBe(0);
  });

  it("400 bad_change re-stamps a far-future pending change to now and retries once", async () => {
    const server = new FakeSyncServer(TOKEN);
    const a = await device();
    const future = clock + 30 * 3600_000; // written while the device clock was wrong
    await applyUntracked(a, async () => {
      await a.items.put({ ...item("future"), updatedAt: future });
      await a.pending.put({ table: "items", id: "future", updatedAt: future });
    });
    await a.items.add(item("normal"));
    const out = await syncOnce({ db: a, fetch: server.fetch });
    expect(out.kind).toBe("ok");
    expect(server.syncRequests.map((r) => r.status)).toEqual([400, 200]);
    expect((await a.items.get("future"))!.updatedAt).toBe(clock);
    expect(server.data("items", "future")!.updatedAt).toBe(clock);
    expect(await a.pending.count()).toBe(0);
    expect(FUTURE_RESTAMP_MS).toBe(23 * 3600_000);
  });

  it("400 bad_change twice shows the error and keeps everything pending", async () => {
    const server = new FakeSyncServer(TOKEN);
    const a = await device();
    await a.items.add(item("x"));
    server.inject({ status: 400, body: { error: "bad_change" } }, { status: 400, body: { error: "bad_change" } });
    const out = await syncOnce({ db: a, fetch: server.fetch });
    expect(out.kind).toBe("error");
    expect(server.requests).toHaveLength(2);
    expect(await a.pending.count()).toBe(1);
  });

  it("offline: a failed fetch keeps everything pending and loses nothing", async () => {
    const server = new FakeSyncServer(TOKEN);
    const a = await device();
    await a.items.bulkAdd([item("p"), item("q")]);
    server.inject({ networkError: true });
    const out = await syncOnce({ db: a, fetch: server.fetch });
    expect(out.kind).toBe("offline");
    expect(await a.items.count()).toBe(2);
    expect(await a.pending.count()).toBe(2);
    expect(await getMeta(a, "cursor")).toBe(0); // unchanged since the address was saved
    expect((await syncOnce({ db: a, fetch: server.fetch })).kind).toBe("ok");
    expect(server.rows.size).toBe(2);
  });

  it("other server errors are shown calmly and keep everything pending", async () => {
    for (const [status, error] of [[413, "payload_too_large"], [500, "internal"]] as const) {
      const server = new FakeSyncServer(TOKEN);
      const a = await device();
      await a.items.add(item("x"));
      server.inject({ status, body: { error } });
      const out = await syncOnce({ db: a, fetch: server.fetch });
      expect(out.kind).toBe("error");
      expect((out as { message: string }).message).not.toMatch(/\d{3}|error|stack/i);
      expect(await a.pending.count()).toBe(1);
    }
  });

  it("an old copy of a row delivered again never replaces a newer synced row", async () => {
    const a = await device();
    await applyUntracked(a, () => a.items.put({ ...item("x", { title: "new" }), updatedAt: 500 }));
    const reply = { cursor: 1, applied: 0, ignored: 0, hasMore: false,
      changes: [{ table: "items", id: "x", updatedAt: 300, data: { ...item("x", { title: "old" }), updatedAt: 300 } }] };
    await syncOnce({ db: a, fetch: async () => new Response(JSON.stringify(reply), { status: 200 }) });
    expect((await a.items.get("x"))!.title).toBe("new");
  });

  it("a row from the server that is not a valid item is not stored", async () => {
    const a = await device();
    const reply = { cursor: 1, applied: 0, ignored: 0, hasMore: false,
      changes: [{ table: "items", id: "bad", updatedAt: 5, data: { id: "bad", updatedAt: 5, title: 3 } }] };
    const out = await syncOnce({ db: a, fetch: async () => new Response(JSON.stringify(reply), { status: 200 }) });
    expect(out.kind).toBe("ok");
    expect(await a.items.get("bad")).toBeUndefined();
  });
});
