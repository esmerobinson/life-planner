import { FakeSyncServer } from "./fakeServer";

// The fake must itself follow the contract, or the engine tests prove nothing.
const TOKEN = "a".repeat(64); // fake
const DEV_A = "device-aaaaaaaa";
const DEV_B = "device-bbbbbbbb";
const NOW = 1_800_000_000_000;

const change = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({
  table: "items", id, updatedAt, data: { id, updatedAt, title: id, ...extra },
});

async function post(server: FakeSyncServer, body: unknown, token = TOKEN) {
  const res = await server.fetch("https://sync.example.test/v1/sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe("FakeSyncServer (contract v1.1)", () => {
  const make = (opts = {}) => new FakeSyncServer(TOKEN, { now: () => NOW, ...opts });

  it("answers health without auth and rejects a wrong token with 401", async () => {
    const s = make();
    const health = await s.fetch("https://sync.example.test/v1/health");
    expect(await health.json()).toEqual({ ok: true, version: 1 });
    expect(await post(s, { deviceId: DEV_A, cursor: 0, changes: [] }, "b".repeat(64))).toEqual({
      status: 401, body: { error: "unauthorized" },
    });
  });

  it("last write wins, with the greater deviceId winning a tie", async () => {
    const s = make();
    await post(s, { deviceId: DEV_B, cursor: 0, changes: [change("x", 10, { title: "B" })] });
    const r = await post(s, { deviceId: DEV_A, cursor: 0, changes: [change("x", 10, { title: "A" })] });
    expect(r.body).toMatchObject({ applied: 0, ignored: 1 });
    expect(s.data("items", "x")!.title).toBe("B");
    await post(s, { deviceId: DEV_A, cursor: 0, changes: [change("x", 11, { title: "A2" })] });
    expect(s.data("items", "x")!.title).toBe("A2");
  });

  it("excludes the caller's own just-sent rows, returns winners, and sets the cursor", async () => {
    const s = make();
    await post(s, { deviceId: DEV_B, cursor: 0, changes: [change("w", 50)] }); // seq 1
    const r = await post(s, { deviceId: DEV_A, cursor: 1, changes: [change("mine", 5), change("w", 40)] });
    // "mine" is excluded (own sent version); "w" is a returned winner (stored 50 beats 40).
    expect(r.body.changes.map((c: { id: string; updatedAt: number }) => [c.id, c.updatedAt])).toEqual([["w", 50]]);
    expect(r.body).toMatchObject({ applied: 1, ignored: 1, hasMore: false, cursor: 2 });
  });

  it("returns the stored row when this request reused its own timestamp for different data", async () => {
    const s = make();
    await post(s, { deviceId: DEV_A, cursor: 0, changes: [change("x", 7, { title: "first" })] });
    const r = await post(s, { deviceId: DEV_A, cursor: 0, changes: [change("x", 7, { title: "second" })] });
    expect(r.body).toMatchObject({ applied: 0, ignored: 1 });
    expect(r.body.changes.map((c: { data: { title: string } }) => c.data.title)).toEqual(["first"]);
  });

  it("pages with hasMore, cursor = last paged seq, and 409 when the cursor is ahead", async () => {
    const s = make({ pageSize: 2 });
    await post(s, { deviceId: DEV_B, cursor: 0, changes: [change("a", 1), change("b", 1), change("c", 1)] });
    const p1 = await post(s, { deviceId: DEV_A, cursor: 0, changes: [] });
    expect(p1.body).toMatchObject({ hasMore: true, cursor: 2 });
    const p2 = await post(s, { deviceId: DEV_A, cursor: 2, changes: [] });
    expect(p2.body).toMatchObject({ hasMore: false, cursor: 3 });
    expect(await post(s, { deviceId: DEV_A, cursor: 99, changes: [] })).toEqual({ status: 409, body: { error: "cursor_ahead" } });
  });

  it("rejects a change more than 24 h in the future with 400 bad_change, applying nothing", async () => {
    const s = make();
    const r = await post(s, { deviceId: DEV_A, cursor: 0, changes: [change("ok", 1), change("late", NOW + 25 * 3600_000)] });
    expect(r).toEqual({ status: 400, body: { error: "bad_change" } });
    expect(s.rows.size).toBe(0);
  });

  it("a replayed request changes nothing", async () => {
    const s = make();
    const body = { deviceId: DEV_A, cursor: 0, changes: [change("a", 3)] };
    await post(s, body);
    const again = await post(s, body);
    expect(again.body).toMatchObject({ applied: 0, ignored: 1, changes: [] });
    expect(s.seq).toBe(1);
  });
});
