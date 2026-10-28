import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, MAX_CHANGES, MAX_FUTURE_MS, MAX_ID_LENGTH, MAX_ROW_BYTES } from "../../src/http";
import { chunkEntries, MAX_RESPONSE_DATA_BYTES, PAGE_SIZE, validateSyncRequest } from "../../src/sync";
import {
  call,
  change,
  type Change,
  DEVICE_A,
  DEVICE_B,
  DEVICE_C,
  errorOf,
  pullAll,
  seqCounter,
  storedRows,
  sync,
  syncOk,
  T0,
} from "./helpers";

const ids = (changes: Change[]) => changes.map((c) => c.id);

describe("limits match the contract", () => {
  it("has the documented limits", () => {
    expect(MAX_BODY_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_CHANGES).toBe(2000);
    expect(PAGE_SIZE).toBe(500);
    expect(MAX_RESPONSE_DATA_BYTES).toBe(1024 * 1024);
    expect(MAX_FUTURE_MS).toBe(24 * 60 * 60 * 1000);
    expect(MAX_ID_LENGTH).toBe(128);
  });
});

describe("POST /v1/sync: writing", () => {
  it("inserts new rows and assigns increasing sequence numbers", async () => {
    const body = await syncOk(DEVICE_A, 0, [change("a", T0 - 3), change("b", T0 - 2), change("g1", T0 - 1, { title: "goal" }, "goals")]);
    // Nothing to page and hasMore is false, so the cursor jumps to the server's highest seq.
    expect(body).toMatchObject({ applied: 3, ignored: 0, hasMore: false, changes: [], cursor: 3 });
    const rows = await storedRows();
    expect(rows.map((r) => [r.tbl, r.id, r.updated_at, r.device_id])).toEqual([
      ["goals", "g1", T0 - 1, DEVICE_A],
      ["items", "a", T0 - 3, DEVICE_A],
      ["items", "b", T0 - 2, DEVICE_A],
    ]);
    expect(rows.map((r) => r.seq).sort()).toEqual([1, 2, 3]);
    expect(await seqCounter()).toBe(3);
    expect(JSON.parse(rows[0]!.data)).toEqual({ title: "goal" });
  });

  it("accepts a pull-only request (no changes) and ignores unknown top-level keys", async () => {
    const response = await call("/v1/sync", { method: "POST", body: { deviceId: DEVICE_A, cursor: 0, changes: [], extra: { x: 1 } } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cursor: 0, applied: 0, ignored: 0, hasMore: false, changes: [] });
  });

  it("treats the same id in different tables as different rows", async () => {
    await syncOk(DEVICE_A, 0, [change("same", 1, { t: "i" }, "items"), change("same", 1, { t: "g" }, "goals")]);
    expect((await storedRows()).map((r) => [r.tbl, r.id])).toEqual([["goals", "same"], ["items", "same"]]);
  });

  it("accepts the files table (pictures on pages) and returns its rows to other devices", async () => {
    const picture = { id: "p1", mime: "image/jpeg", data: "/9j/4AAQ", width: 1600, height: 1200, createdAt: "2026-10-28" };
    const body = await syncOk(DEVICE_A, 0, [change("p1", T0 - 1, picture, "files"), change("same", T0 - 1, { t: "i" }, "items")]);
    expect(body).toMatchObject({ applied: 2, ignored: 0 });
    expect((await storedRows()).map((r) => [r.tbl, r.id])).toEqual([["files", "p1"], ["items", "same"]]);
    const pulled = await pullAll(DEVICE_B);
    expect(pulled.changes).toContainEqual({ table: "files", id: "p1", updatedAt: T0 - 1, data: picture });
  });

  it("a picture row just under 700 KB of JPEG (about 933,000 base64 characters) fits the row cap and pulls alone", async () => {
    const big = (id: string) => ({ id, mime: "image/jpeg", data: "A".repeat(933_336), width: 1600, height: 1200, createdAt: "2026-10-28" });
    await syncOk(DEVICE_A, 0, [change("b1", T0 - 2, big("b1"), "files")]);
    await syncOk(DEVICE_A, 0, [change("b2", T0 - 1, big("b2"), "files")]);
    const pulled = await pullAll(DEVICE_B);
    expect(pulled.changes.map((c) => c.id)).toEqual(["b1", "b2"]);
    // The response byte budget (1 MiB) holds one such row per page.
    expect(pulled.pages.filter((p) => p.changes.length > 0).every((p) => p.changes.length === 1)).toBe(true);
  });
});

describe("POST /v1/sync: last write wins", () => {
  it("ignores older writes and applies newer ones", async () => {
    await syncOk(DEVICE_A, 0, [change("x", 100, { v: "a100" })]);

    const older = await syncOk(DEVICE_B, 0, [change("x", 99, { v: "b99" })]);
    expect(older).toMatchObject({ applied: 0, ignored: 1 });
    expect(JSON.parse((await storedRows())[0]!.data)).toEqual({ v: "a100" });

    const newer = await syncOk(DEVICE_B, 0, [change("x", 101, { v: "b101" })]);
    expect(newer).toMatchObject({ applied: 1, ignored: 0 });
    const [row] = await storedRows();
    expect(JSON.parse(row!.data)).toEqual({ v: "b101" });
    expect(row!.device_id).toBe(DEVICE_B);
    expect(row!.seq).toBe(2);
  });

  it("breaks equal-updatedAt ties by the greater deviceId: lower device first", async () => {
    await syncOk(DEVICE_A, 0, [change("x", 100, { v: "A" })]);
    const b = await syncOk(DEVICE_B, 0, [change("x", 100, { v: "B" })]);
    expect(b).toMatchObject({ applied: 1, ignored: 0 });
    expect(JSON.parse((await storedRows())[0]!.data)).toEqual({ v: "B" });
  });

  it("breaks equal-updatedAt ties by the greater deviceId: higher device first", async () => {
    await syncOk(DEVICE_B, 0, [change("x", 100, { v: "B" })]);
    const a = await syncOk(DEVICE_A, 0, [change("x", 100, { v: "A" })]);
    expect(a).toMatchObject({ applied: 0, ignored: 1 });
    const [row] = await storedRows();
    expect(JSON.parse(row!.data)).toEqual({ v: "B" });
    expect(row!.device_id).toBe(DEVICE_B);
  });

  it("uses plain code-unit order for the tie-break (deterministic, locale-free)", async () => {
    // "Z" (0x5A) < "a" (0x61) in code-unit order.
    await syncOk("device-a", 0, [change("x", 5, { v: "lower-a" })]);
    const upper = await syncOk("device-Z", 0, [change("x", 5, { v: "upper-Z" })]);
    expect(upper.ignored).toBe(1);
    expect(JSON.parse((await storedRows())[0]!.data)).toEqual({ v: "lower-a" });
  });

  it("applies several changes to the same row within one request in order", async () => {
    const body = await syncOk(DEVICE_A, 0, [change("x", 5, { v: 5 }), change("x", 3, { v: 3 }), change("x", 7, { v: 7 })]);
    expect(body).toMatchObject({ applied: 2, ignored: 1, changes: [] });
    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.data)).toEqual({ v: 7 });
  });

  it("is idempotent: replaying a request changes nothing and returns the same rows", async () => {
    await syncOk(DEVICE_B, 0, [change("other", 50, { v: "from B" })]);
    const request = [change("x", 100, { v: 1 }), change("y", 101, { v: 2 })];
    const first = await syncOk(DEVICE_A, 0, request);
    const rowsAfterFirst = await storedRows();
    const counterAfterFirst = await seqCounter();

    const replay = await syncOk(DEVICE_A, 0, request);
    expect(replay).toEqual({ ...first, applied: 0, ignored: 2 });
    expect(await storedRows()).toEqual(rowsAfterFirst);
    expect(await seqCounter()).toBe(counterAfterFirst);
    expect(ids(first.changes)).toEqual(["other"]);
  });
});

describe("POST /v1/sync: cursor and pagination", () => {
  it("cursor 0 returns everything; the cursor is the max seq returned; reusing it returns nothing new", async () => {
    await syncOk(DEVICE_A, 0, [change("a", 1), change("b", 2)]);
    await syncOk(DEVICE_B, 0, [change("c", 3)]);

    const first = await syncOk(DEVICE_C, 0, []);
    expect(ids(first.changes)).toEqual(["a", "b", "c"]);
    expect(first.cursor).toBe(3);
    expect(first.hasMore).toBe(false);

    const second = await syncOk(DEVICE_C, first.cursor, []);
    expect(second).toEqual({ cursor: first.cursor, applied: 0, ignored: 0, hasMore: false, changes: [] });

    await syncOk(DEVICE_A, 0, [change("a", 10, { title: "a2" })]);
    const third = await syncOk(DEVICE_C, second.cursor, []);
    expect(third.changes).toEqual([change("a", 10, { title: "a2" })]);
    expect(third.cursor).toBe(4);
  });

  it("returns changes ordered by seq with exactly the contract fields", async () => {
    await syncOk(DEVICE_A, 0, [change("z", 1), change("y", 2, { n: 1 }, "goals")]);
    const body = await syncOk(DEVICE_B, 0, []);
    expect(body.changes).toEqual([
      { table: "items", id: "z", updatedAt: 1, data: { title: "z" } },
      { table: "goals", id: "y", updatedAt: 2, data: { n: 1 } },
    ]);
  });

  it("paginates more than 500 rows; following the cursor yields every row exactly once", async () => {
    const total = 1201;
    const batch1 = Array.from({ length: 1000 }, (_, i) => change(`r${i}`, T0 - 10_000 + i));
    const batch2 = Array.from({ length: total - 1000 }, (_, i) => change(`r${1000 + i}`, T0 - 10_000 + 1000 + i, { title: `r${1000 + i}` }, "goals"));
    await syncOk(DEVICE_A, 0, batch1);
    await syncOk(DEVICE_A, 0, batch2);

    const { changes, pages } = await pullAll(DEVICE_C);
    expect(pages.map((p) => [p.changes.length, p.hasMore])).toEqual([
      [500, true],
      [500, true],
      [201, false],
    ]);
    expect(changes).toHaveLength(total);
    expect(new Set(changes.map((c) => `${c.table}/${c.id}`)).size).toBe(total);
    const cursors = pages.map((p) => p.cursor);
    expect(cursors).toEqual([...cursors].sort((a, b) => a - b));
    expect(cursors.at(-1)).toBe(total);
  });

  it("pagination survives writes between pages (rewritten rows move to the end, still exactly once per version)", async () => {
    await syncOk(DEVICE_A, 0, Array.from({ length: 600 }, (_, i) => change(`r${i}`, 1000 + i)));
    const page1 = await syncOk(DEVICE_C, 0, []);
    expect(page1.changes).toHaveLength(500);
    // Rewrite one row already delivered and one not yet delivered.
    await syncOk(DEVICE_B, 0, [change("r0", 5000, { v: "new0" }), change("r550", 5000, { v: "new550" })]);
    const rest = await pullAll(DEVICE_C, page1.cursor);
    const restIds = ids(rest.changes);
    expect(restIds.filter((id) => id === "r550")).toHaveLength(1);
    expect(restIds.slice(-2)).toEqual(["r0", "r550"]);
    const final = new Map<string, Change>();
    for (const c of [...page1.changes, ...rest.changes]) final.set(c.id, c);
    expect(final.size).toBe(600);
    expect(final.get("r0")!.data).toEqual({ v: "new0" });
    expect(final.get("r550")!.data).toEqual({ v: "new550" });
  });

  it("caps the data bytes per response (at least one row per page) and still delivers everything once", async () => {
    const big = (n: number) => ({ blob: String(n).padEnd(900_000, "x") });
    await syncOk(DEVICE_A, 0, [change("big0", 1, big(0)), change("big1", 2, big(1)), change("big2", 3, big(2))]);
    await syncOk(DEVICE_A, 0, [change("big3", 4, big(3)), change("big4", 5, big(4)), change("big5", 6, big(5))]);
    const { changes, pages } = await pullAll(DEVICE_C);
    expect(changes.map((c) => c.id)).toEqual(["big0", "big1", "big2", "big3", "big4", "big5"]);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      const bytes = page.changes.reduce((sum, c) => sum + JSON.stringify(c.data).length, 0);
      expect(page.changes.length).toBeGreaterThan(0);
      if (page.changes.length > 1) expect(bytes).toBeLessThanOrEqual(MAX_RESPONSE_DATA_BYTES);
    }
  });
});

describe("POST /v1/sync: exclusion rule", () => {
  it("does not return rows the caller wrote in this request, but does return other devices' older rows", async () => {
    await syncOk(DEVICE_B, 0, [change("fromB", 10)]);
    const body = await syncOk(DEVICE_A, 0, [change("fromA", 20)]);
    expect(ids(body.changes)).toEqual(["fromB"]);
    expect(body.cursor).toBe(2); // hasMore false: past this request's own write too
  });

  it("does not send a device its own writes back on its next sync", async () => {
    const first = await syncOk(DEVICE_A, 0, [change("mine", 20)]);
    const next = await syncOk(DEVICE_A, first.cursor, []);
    expect(next.changes).toEqual([]);
  });

  it("returns the caller's own rows from an earlier request (only this request's writes are hidden)", async () => {
    await syncOk(DEVICE_A, 0, [change("earlier", 10)]);
    const body = await syncOk(DEVICE_A, 0, [change("now", 20)]);
    expect(ids(body.changes)).toEqual(["earlier"]);
  });

  it("returns the winning row when the caller's change lost", async () => {
    await syncOk(DEVICE_B, 0, [change("x", 100, { v: "B wins" })]);
    const body = await syncOk(DEVICE_A, 0, [change("x", 50, { v: "A loses" })]);
    expect(body.ignored).toBe(1);
    expect(body.changes).toEqual([change("x", 100, { v: "B wins" })]);
  });

  it("does not hide another device's row that has the same id/updatedAt as the caller's change", async () => {
    await syncOk(DEVICE_B, 0, [change("x", 100, { v: "B" })]); // B > A wins the tie
    const body = await syncOk(DEVICE_A, 0, [change("x", 100, { v: "A" })]);
    expect(body.changes).toEqual([change("x", 100, { v: "B" })]);
  });
});

describe("POST /v1/sync: returned winners", () => {
  it("tells a device whose change lost to clock skew about the winner, even below its cursor", async () => {
    await syncOk(DEVICE_B, 0, [change("x", 200, { v: "B" })]);
    const pulled = await syncOk(DEVICE_A, 0, []);
    expect(pulled.changes).toEqual([change("x", 200, { v: "B" })]);
    // A's clock is behind: its later edit carries an older timestamp and loses.
    const lost = await syncOk(DEVICE_A, pulled.cursor, [change("x", 150, { v: "A" })]);
    expect(lost.ignored).toBe(1);
    expect(lost.changes).toEqual([change("x", 200, { v: "B" })]);
    expect(lost.cursor).toBe(pulled.cursor); // returned winners never move the cursor
  });

  it("returns the stored version when the same device reuses a timestamp with different data", async () => {
    const first = await syncOk(DEVICE_A, 0, [change("x", 100, { v: 1 })]);
    const second = await syncOk(DEVICE_A, first.cursor, [change("x", 100, { v: 2 })]);
    expect(second.ignored).toBe(1);
    expect(second.changes).toEqual([change("x", 100, { v: 1 })]);
  });

  it("returns no winners for changes that were applied or that exactly match the stored row", async () => {
    await syncOk(DEVICE_B, 0, [change("other", 50, { v: "from B" })]);
    const request = [change("x", 100, { v: 1 }), change("x", 90, { v: 0 }), change("y", 101, { v: 2 })];
    const first = await syncOk(DEVICE_A, 0, request);
    expect(ids(first.changes)).toEqual(["other"]);
    const replay = await syncOk(DEVICE_A, 0, request);
    expect(replay).toEqual({ ...first, applied: 0, ignored: 3 });
    const replayAtCursor = await syncOk(DEVICE_A, first.cursor, request);
    expect(replayAtCursor.changes).toEqual([]);
  });

  it("appends winners after the paged rows, outside the page limit, without moving the cursor", async () => {
    await syncOk(DEVICE_B, 0, Array.from({ length: 600 }, (_, i) => change(`r${i}`, 1000 + i)));
    await syncOk(DEVICE_B, 0, [change("x", 200, { v: "B" })]); // seq 601
    const body = await syncOk(DEVICE_A, 0, [change("x", 150, { v: "A" })]);
    expect(body.hasMore).toBe(true);
    expect(body.changes).toHaveLength(PAGE_SIZE + 1);
    expect(body.changes.at(-1)).toEqual(change("x", 200, { v: "B" }));
    expect(body.cursor).toBe(500);
  });

  it("returns each winner at most once even if the request names the row several times", async () => {
    await syncOk(DEVICE_B, 0, [change("x", 500, { v: "B" })]);
    const pulled = await syncOk(DEVICE_A, 0, []);
    const body = await syncOk(DEVICE_A, pulled.cursor, [change("x", 1, { v: 1 }), change("x", 2, { v: 2 })]);
    expect(body.changes).toEqual([change("x", 500, { v: "B" })]);
  });
});

describe("POST /v1/sync: cursor ahead of the server", () => {
  it("answers 409 cursor_ahead and applies nothing", async () => {
    await syncOk(DEVICE_A, 0, [change("a", 1)]); // server seq = 1
    const response = await call("/v1/sync", { method: "POST", body: { deviceId: DEVICE_B, cursor: 2, changes: [change("b", 1)] } });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("cursor_ahead");
    expect((await storedRows()).map((r) => r.id)).toEqual(["a"]);
    expect(await seqCounter()).toBe(1);
  });

  it("accepts a cursor equal to the server's highest seq", async () => {
    await syncOk(DEVICE_A, 0, [change("a", 1)]);
    const body = await syncOk(DEVICE_B, 1, []);
    expect(body).toEqual({ cursor: 1, applied: 0, ignored: 0, hasMore: false, changes: [] });
  });
});

/**
 * A tiny client following the contract's client obligations: local rows + unsent changes +
 * cursor. Sent changes are acknowledged after a successful response (unless edited again
 * meanwhile); returned rows are applied unless a NEWER unsent local change exists.
 */
class SimDevice {
  rows = new Map<string, Change>();
  unsent = new Map<string, Change>();
  cursor = 0;
  constructor(readonly deviceId: string) {}
  edit(c: Change) {
    const key = `${c.table}/${c.id}`;
    this.rows.set(key, c);
    this.unsent.set(key, c);
  }
  async sync() {
    for (;;) {
      const sending = [...this.unsent.entries()];
      const body = await syncOk(this.deviceId, this.cursor, sending.map(([, c]) => c));
      for (const [key, c] of sending) if (this.unsent.get(key) === c) this.unsent.delete(key);
      for (const c of body.changes) {
        const key = `${c.table}/${c.id}`;
        const local = this.unsent.get(key);
        if (local && local.updatedAt > c.updatedAt) continue;
        this.rows.set(key, c);
      }
      this.cursor = body.cursor;
      if (!body.hasMore) return;
    }
  }
  snapshot() {
    return [...this.rows.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }
}

describe("POST /v1/sync: convergence", () => {
  it("converges when a device with a slow clock loses an edit to a row it already received", async () => {
    const a = new SimDevice(DEVICE_A);
    const b = new SimDevice(DEVICE_B);
    b.edit(change("x", 200, { by: "B" }));
    await b.sync();
    await a.sync();
    a.edit(change("x", 150, { by: "A, slow clock" })); // older timestamp: loses
    await a.sync();
    await b.sync();
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.rows.get("items/x")!.data).toEqual({ by: "B" });
  });

  it("converges when a device reuses a timestamp for different content", async () => {
    const a = new SimDevice(DEVICE_A);
    const b = new SimDevice(DEVICE_B);
    a.edit(change("x", 100, { v: 1 }));
    await a.sync();
    a.edit(change("x", 100, { v: 2 })); // same device, same timestamp: ignored by the server
    await a.sync();
    await b.sync();
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.rows.get("items/x")!.data).toEqual({ v: 1 });
  });

  const orders: Array<Array<"A" | "B">> = [
    ["A", "B", "A"],
    ["B", "A", "B"],
    ["A", "A", "B", "A"],
    ["B", "B", "A", "B"],
  ];
  for (const order of orders) {
    it(`two devices converge after exchanging in order ${order.join(",")}`, async () => {
      const a = new SimDevice(DEVICE_A);
      const b = new SimDevice(DEVICE_B);
      a.edit(change("r1", 100, { by: "A" }));
      a.edit(change("r2", 200, { by: "A" }));
      a.edit(change("r3", 300, { by: "A" }));
      a.edit(change("g1", 300, { by: "A" }, "goals"));
      b.edit(change("r1", 150, { by: "B" }));
      b.edit(change("r2", 50, { by: "B" }));
      b.edit(change("r3", 300, { by: "B" })); // tie: B wins
      b.edit(change("r4", 10, { by: "B" }));
      for (const who of order) await (who === "A" ? a : b).sync();
      await a.sync();
      await b.sync();
      expect(a.snapshot()).toEqual(b.snapshot());
      const expected = {
        "goals/g1": { by: "A" },
        "items/r1": { by: "B" },
        "items/r2": { by: "A" },
        "items/r3": { by: "B" },
        "items/r4": { by: "B" },
      };
      expect(Object.fromEntries(a.snapshot().map(([k, v]) => [k, v.data]))).toEqual(expected);
      const server = await storedRows();
      expect(Object.fromEntries(server.map((r) => [`${r.tbl}/${r.id}`, JSON.parse(r.data)]))).toEqual(expected);
    });
  }
});

describe("POST /v1/sync: validation", () => {
  const good = () => change("ok", T0 - 1);
  const cases: Array<[string, unknown, string]> = [
    ["bad table name", { deviceId: DEVICE_A, cursor: 0, changes: [good(), change("x", 1, {}, "journal")] }, "bad_change"],
    ["table name with different case", { deviceId: DEVICE_A, cursor: 0, changes: [good(), change("x", 1, {}, "Items")] }, "bad_change"],
    ["files table name with different case", { deviceId: DEVICE_A, cursor: 0, changes: [good(), change("x", 1, {}, "Files")] }, "bad_change"],
    ["empty id", { deviceId: DEVICE_A, cursor: 0, changes: [good(), change("", 1)] }, "bad_change"],
    ["id over 128 chars", { deviceId: DEVICE_A, cursor: 0, changes: [good(), change("x".repeat(MAX_ID_LENGTH + 1), 1)] }, "bad_change"],
    ["id not a string", { deviceId: DEVICE_A, cursor: 0, changes: [good(), { table: "items", id: 7, updatedAt: 1, data: {} }] }, "bad_change"],
    ["id with a lone surrogate", { deviceId: DEVICE_A, cursor: 0, changes: [good(), change("bad\ud800", 1)] }, "bad_change"],
    ["data is null", { deviceId: DEVICE_A, cursor: 0, changes: [good(), change("x", 1, null)] }, "bad_change"],
    ["data is an array", { deviceId: DEVICE_A, cursor: 0, changes: [good(), change("x", 1, [1, 2])] }, "bad_change"],
    ["data is a string", { deviceId: DEVICE_A, cursor: 0, changes: [good(), change("x", 1, "ciphertext")] }, "bad_change"],
    ["data is a number", { deviceId: DEVICE_A, cursor: 0, changes: [good(), change("x", 1, 5)] }, "bad_change"],
    ["data missing", { deviceId: DEVICE_A, cursor: 0, changes: [good(), { table: "items", id: "x", updatedAt: 1 }] }, "bad_change"],
    ["updatedAt zero", { deviceId: DEVICE_A, cursor: 0, changes: [good(), change("x", 0)] }, "bad_change"],
    ["updatedAt negative", { deviceId: DEVICE_A, cursor: 0, changes: [good(), change("x", -5)] }, "bad_change"],
    ["updatedAt float", { deviceId: DEVICE_A, cursor: 0, changes: [good(), change("x", 1.5)] }, "bad_change"],
    ["updatedAt string", { deviceId: DEVICE_A, cursor: 0, changes: [good(), change("x", "1" as unknown as number)] }, "bad_change"],
    ["updatedAt unsafe integer", { deviceId: DEVICE_A, cursor: 0, changes: [good(), change("x", 2 ** 53)] }, "bad_change"],
    ["updatedAt too far in the future", { deviceId: DEVICE_A, cursor: 0, changes: [good(), change("x", T0 + MAX_FUTURE_MS + 1)] }, "bad_change"],
    ["change not an object", { deviceId: DEVICE_A, cursor: 0, changes: [good(), "nope"] }, "bad_change"],
    ["change is null", { deviceId: DEVICE_A, cursor: 0, changes: [good(), null] }, "bad_change"],
    ["more than 2000 changes", { deviceId: DEVICE_A, cursor: 0, changes: Array.from({ length: MAX_CHANGES + 1 }, (_, i) => change(`c${i}`, 1)) }, "too_many_changes"],
    ["changes missing", { deviceId: DEVICE_A, cursor: 0 }, "bad_changes"],
    ["changes not an array", { deviceId: DEVICE_A, cursor: 0, changes: { 0: good() } }, "bad_changes"],
    ["deviceId too short", { deviceId: "short", cursor: 0, changes: [good()] }, "bad_device_id"],
    ["deviceId too long", { deviceId: "d".repeat(65), cursor: 0, changes: [good()] }, "bad_device_id"],
    ["deviceId with bad characters", { deviceId: "device aaaa", cursor: 0, changes: [good()] }, "bad_device_id"],
    ["deviceId with a slash", { deviceId: "device/aaaa", cursor: 0, changes: [good()] }, "bad_device_id"],
    ["deviceId missing", { cursor: 0, changes: [good()] }, "bad_device_id"],
    ["deviceId not a string", { deviceId: 12345678, cursor: 0, changes: [good()] }, "bad_device_id"],
    ["cursor negative", { deviceId: DEVICE_A, cursor: -1, changes: [good()] }, "bad_cursor"],
    ["cursor float", { deviceId: DEVICE_A, cursor: 1.5, changes: [good()] }, "bad_cursor"],
    ["cursor string", { deviceId: DEVICE_A, cursor: "0", changes: [good()] }, "bad_cursor"],
    ["cursor missing", { deviceId: DEVICE_A, changes: [good()] }, "bad_cursor"],
    ["top level is an array", [good()], "bad_request"],
    ["top level is null", null, "bad_request"],
  ];

  it.each(cases)("400s on %s and applies nothing", async (_name, body, code) => {
    const response = await call("/v1/sync", { method: "POST", body });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe(code);
    expect(await storedRows()).toEqual([]);
    expect(await seqCounter()).toBe(0);
  });

  it("accepts exactly 2000 changes and an updatedAt exactly 24 h ahead", async () => {
    const changes = Array.from({ length: MAX_CHANGES }, (_, i) => change(`c${i}`, i + 1));
    changes[0] = change("future", T0 + MAX_FUTURE_MS);
    const body = await syncOk(DEVICE_A, 0, changes);
    expect(body.applied).toBe(MAX_CHANGES);
    expect(await seqCounter()).toBe(MAX_CHANGES);
  });

  it("accepts ids of exactly 128 chars and deviceIds of 8 and 64 chars", async () => {
    await syncOk("d".repeat(8), 0, [change("i".repeat(MAX_ID_LENGTH), 1)]);
    await syncOk("D_-9".repeat(16), 0, [change("j", 1)]);
    expect(await storedRows()).toHaveLength(2);
  });

  it("400s on malformed JSON", async () => {
    for (const rawBody of ["{not json", "", '{"deviceId":', "\u0000", '{"a":1}{"b":2}']) {
      const response = await call("/v1/sync", { method: "POST", rawBody });
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toBe("bad_json");
    }
  });

  it("400s on a body that is not valid UTF-8", async () => {
    const response = await call("/v1/sync", { method: "POST", rawBody: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe("bad_json");
  });

  it("415s when the Content-Type is not JSON", async () => {
    for (const contentType of [null, "text/plain", "application/x-www-form-urlencoded", "application/jsonp"]) {
      const response = await call("/v1/sync", { method: "POST", body: { deviceId: DEVICE_A, cursor: 0, changes: [] }, contentType });
      expect(response.status).toBe(415);
      expect(await errorOf(response)).toBe("unsupported_media_type");
    }
    const ok = await call("/v1/sync", { method: "POST", body: { deviceId: DEVICE_A, cursor: 0, changes: [] }, contentType: "application/json; charset=utf-8" });
    expect(ok.status).toBe(200);
  });

  it("413s a body over 5 MB (with Content-Length) and applies nothing", async () => {
    const filler = "x".repeat(MAX_BODY_BYTES);
    const response = await call("/v1/sync", { method: "POST", body: { deviceId: DEVICE_A, cursor: 0, changes: [change("a", 1, { filler })] } });
    expect(response.status).toBe(413);
    expect(await errorOf(response)).toBe("payload_too_large");
    expect(await storedRows()).toEqual([]);
  });

  it("413s a streamed body over 5 MB without Content-Length", async () => {
    const chunk = new TextEncoder().encode("x".repeat(1024 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 6) return controller.close();
        sent++;
        controller.enqueue(chunk);
      },
    });
    const response = await call("/v1/sync", { method: "POST", rawBody: stream });
    expect(response.status).toBe(413);
    expect(await errorOf(response)).toBe("payload_too_large");
  });

  it("400s a single row whose data exceeds the per-row limit", async () => {
    const response = await call("/v1/sync", {
      method: "POST",
      body: { deviceId: DEVICE_A, cursor: 0, changes: [good(), change("huge", 1, { s: "y".repeat(MAX_ROW_BYTES) })] },
    });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe("row_too_large");
    expect(await storedRows()).toEqual([]);
  });

  it("never echoes input in error bodies", async () => {
    const marker = "ECHO-MARKER-not-a-secret";
    const response = await call("/v1/sync", { method: "POST", body: { deviceId: marker, cursor: 0, changes: [] } });
    expect(await response.text()).not.toContain(marker);
  });
});

describe("POST /v1/sync: data round-trips byte-for-byte", () => {
  it("keeps unicode, emoji, long strings and nested objects intact", async () => {
    const data = {
      title: "Café \u{1F600}\u{1F469}‍\u{1F4BB} 日本語 مرحبا é",
      quotes: "\"double\" 'single' \\back\\slash\\ \n\t\r",
      separators: "  ",
      control: "\u0000\u0001\u001f",
      long: "é\u{1F680}".repeat(50_000),
      nested: { a: [1, 2.5, -0.125, 1e21, true, false, null, { deep: { deeper: ["x", { deepest: "\u{1F525}" }] } }], empty: {}, list: [] },
      protoKey: JSON.parse('{"__proto__":"not special","constructor":{"prototype":1}}') as unknown,
      number: 9007199254740991,
    };
    await syncOk(DEVICE_A, 0, [change("u", 1, data)]);
    const response = await call("/v1/sync", { method: "POST", body: { deviceId: DEVICE_B, cursor: 0, changes: [] } });
    const text = await response.text();
    expect(text).toContain(`"data":${JSON.stringify(data)}`);
    const body = JSON.parse(text) as { changes: Change[] };
    expect(body.changes[0]!.data).toEqual(data);
    expect(JSON.stringify(body.changes[0]!.data)).toBe(JSON.stringify(data));
  });

  it("stores ciphertext-like opaque objects without interpreting them", async () => {
    const data = { v: 1, iv: "AAECAwQFBgcICQoL", ct: "q83vEjRWeJA=".repeat(1000) };
    await syncOk(DEVICE_A, 0, [change("journal-entry", 1, data)]);
    expect((await storedRows())[0]!.data).toBe(JSON.stringify(data));
  });
});

describe("POST /v1/sync: atomicity", () => {
  async function installFailingTrigger() {
    await env.DB.prepare(
      "CREATE TRIGGER fail_on_boom BEFORE INSERT ON rows WHEN NEW.id = 'boom' BEGIN SELECT RAISE(ABORT, 'simulated failure'); END",
    ).run();
  }

  it("applies nothing when a write fails mid-batch", async () => {
    await syncOk(DEVICE_B, 0, [change("existing", 1, { v: "before" })]);
    const before = await storedRows();
    await installFailingTrigger();
    const response = await call("/v1/sync", {
      method: "POST",
      body: { deviceId: DEVICE_A, cursor: 0, changes: [change("existing", 2, { v: "after" }), change("ok1", 1), change("boom", 1), change("ok2", 1)] },
    });
    expect(response.status).toBe(500);
    expect(await errorOf(response)).toBe("internal");
    expect(await storedRows()).toEqual(before);
    expect(await seqCounter()).toBe(1);
  });

  it("applies nothing when a later statement of a multi-statement batch fails", async () => {
    await installFailingTrigger();
    const changes = [...Array.from({ length: 50 }, (_, i) => change(`ok${i}`, 1, { pad: "p".repeat(200) })), change("boom", 1)];
    const response = await call("/v1/sync", {
      method: "POST",
      body: { deviceId: DEVICE_A, cursor: 0, changes },
      deps: { chunkBytes: 2000 }, // forces many statements in the batch
    });
    expect(response.status).toBe(500);
    expect(await storedRows()).toEqual([]);
    expect(await seqCounter()).toBe(0);
  });

  it("chunkEntries keeps order, respects the byte budget and isolates oversize entries", () => {
    const valid = validateSyncRequest(
      { deviceId: DEVICE_A, cursor: 0, changes: [change("a", 1), change("b", 1, { pad: "x".repeat(500) }), change("c", 1), change("d", 1)] },
      T0,
    );
    const chunks = chunkEntries(valid.changes, 200);
    expect(chunks.length).toBeGreaterThan(1);
    const flattened = chunks.flatMap((c) => JSON.parse(c) as Array<{ i: string }>).map((e) => e.i);
    expect(flattened).toEqual(["a", "b", "c", "d"]);
    for (const c of chunks) {
      if ((JSON.parse(c) as unknown[]).length > 1) expect(new TextEncoder().encode(c).byteLength).toBeLessThanOrEqual(200);
    }
    expect(chunkEntries(valid.changes, 1_000_000)).toHaveLength(1);
    expect(chunkEntries([], 1_000_000)).toEqual([]);
  });

  it("small chunks give the same result as one big statement", async () => {
    const changes = Array.from({ length: 60 }, (_, i) => change(`k${i % 40}`, 100 + (i % 7), { i }));
    const big = await syncOk(DEVICE_A, 0, changes);
    const bigRows = (await storedRows()).map(({ seq: _seq, ...rest }) => rest);
    await env.DB.prepare("DELETE FROM rows").run();
    await env.DB.prepare("UPDATE meta SET value = 0 WHERE key = 'seq'").run();
    const small = await syncOk(DEVICE_A, 0, changes, { deps: { chunkBytes: 300 } });
    // Seq gaps (burned by ignored changes) depend on chunking, so the cursor may differ.
    expect({ ...small, cursor: 0 }).toEqual({ ...big, cursor: 0 });
    expect(small.changes).toEqual([]);
    expect((await storedRows()).map(({ seq: _seq, ...rest }) => rest)).toEqual(bigRows);
  });
});
