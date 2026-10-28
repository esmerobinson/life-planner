import { describe, expect, it } from "vitest";
import { EXPORT_PAGE_BYTES, EXPORT_PAGE_ROWS } from "../../src/export";
import { call, change, DEVICE_A, DEVICE_B, errorOf, syncOk, T0 } from "./helpers";

interface ExportBody {
  exportedAt: number;
  items: unknown[];
  goals: unknown[];
}

describe("GET /v1/export", () => {
  it("requires auth", async () => {
    const missing = await call("/v1/export", { token: null });
    expect(missing.status).toBe(401);
    expect(await errorOf(missing)).toBe("unauthorized");
    const wrong = await call("/v1/export", { token: "wrong-token-not-real", ip: "203.0.113.99" });
    expect(wrong.status).toBe(401);
  });

  it("returns an empty export for an empty database", async () => {
    const response = await call("/v1/export");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ exportedAt: T0, items: [], goals: [] });
  });

  it("returns every current row's data, split by table", async () => {
    await syncOk(DEVICE_A, 0, [
      change("i2", 1, { id: "i2", title: "two" }),
      change("i1", 1, { id: "i1", title: "one" }),
      change("g1", 1, { id: "g1", title: "goal" }, "goals"),
    ]);
    await syncOk(DEVICE_B, 0, [change("i1", 2, { id: "i1", title: "one, edited" })]);
    const response = await call("/v1/export", { now: T0 + 5 });
    const body = (await response.json()) as ExportBody;
    expect(body.exportedAt).toBe(T0 + 5);
    expect(body.items).toEqual([
      { id: "i1", title: "one, edited" },
      { id: "i2", title: "two" },
    ]);
    expect(body.goals).toEqual([{ id: "g1", title: "goal" }]);
  });

  it("splits large data across internal pages by bytes and still exports every row once", async () => {
    const big = (n: number) => ({ id: `big${n}`, blob: String(n).padEnd(900_000, "x") });
    await syncOk(DEVICE_A, 0, [0, 1, 2].map((n) => change(`big${n}`, 1, big(n))));
    await syncOk(DEVICE_A, 0, [3, 4, 5].map((n) => change(`big${n}`, 1, big(n))));
    await syncOk(DEVICE_A, 0, [change("small", 1, { id: "small" }, "goals")]);
    expect(6 * 900_000).toBeGreaterThan(EXPORT_PAGE_BYTES);
    const body = (await (await call("/v1/export")).json()) as ExportBody;
    expect(body.items).toEqual([0, 1, 2, 3, 4, 5].map(big));
    expect(body.goals).toEqual([{ id: "small" }]);
  });

  it("exports many rows (multiple internal pages) exactly once each, data verbatim", async () => {
    expect(EXPORT_PAGE_ROWS).toBe(1000); // 1000 items below hits the exact page boundary
    const count = 1234;
    const data = (i: number) => ({ id: `r${i}`, title: `é\u{1F600} ${i}`, nested: { n: i } });
    await syncOk(DEVICE_A, 0, Array.from({ length: 1000 }, (_, i) => change(`r${String(i).padStart(4, "0")}`, 1, data(i))));
    await syncOk(DEVICE_A, 0, Array.from({ length: count - 1000 }, (_, i) => change(`r${1000 + i}`, 1, data(1000 + i), "goals")));
    const response = await call("/v1/export");
    const text = await response.text();
    const body = JSON.parse(text) as ExportBody;
    expect(body.items).toHaveLength(1000);
    expect(body.goals).toHaveLength(count - 1000);
    expect(body.items[7]).toEqual(data(7));
    expect(text).toContain(JSON.stringify(data(999)));
  });
});
