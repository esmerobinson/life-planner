import { createHash } from "node:crypto";
import { togetherId } from "./ids";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

it("is a valid UUID (version 8, RFC variant) worked out from the Esmeworld id", async () => {
  const id = await togetherId("tally", "checkin:2026-11-04", 1);
  expect(id).toMatch(UUID);
});

it("is the first 16 bytes of SHA-256 of the fixed input, with the version and variant bits set", async () => {
  const bytes = createHash("sha256").update("esmeworld-together-v1:tally:checkin:2026-11-04:1").digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  const want = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  expect(await togetherId("tally", "checkin:2026-11-04", 1)).toBe(want);
});

it("the same thing always gets the same id; another kind, id or version never does", async () => {
  const a = await togetherId("tally", "checkin:2026-11-04", 1);
  expect(await togetherId("tally", "checkin:2026-11-04", 1)).toBe(a);
  const others = await Promise.all([
    togetherId("habit", "checkin:2026-11-04", 1),
    togetherId("tally", "exercise:2026-11-04", 1),
    togetherId("tally", "checkin:2026-11-04", 2),
  ]);
  expect(new Set([a, ...others]).size).toBe(4);
});
