import { backupParts, NotJsonError, readBackupJson } from "./backupParts";

// Fictional data only.
const sample = {
  app: "life-hub",
  schema: 1,
  exportedOn: "2026-10-28",
  skipped: undefined,
  items: [
    { id: "a", title: "Pretend “quoted” task, with \\ and \"quotes\"", notes: "line one\nline two\t[x] {y}", links: [] },
    { id: "b", title: "Café crème ☕ 𝄞 naïve", tags: ["one", "two"], nested: { deep: [1, [2, {}], []] } },
  ],
  goals: [],
  files: [{ id: "p", mime: "image/jpeg", data: "A".repeat(5000), width: 2, height: 3 }],
  journal: [null, 0, false, "x", [], {}],
  extra: { a: [1, 2], b: {} },
};

const blobOf = (parts: string[]) => new Blob(parts, { type: "application/json" });

describe("backupParts", () => {
  it("joined, is exactly JSON.stringify(file, null, 2)", () => {
    expect(backupParts(sample).join("")).toBe(JSON.stringify(sample, null, 2));
    expect(backupParts({}).join("")).toBe(JSON.stringify({}, null, 2));
    expect(backupParts({ items: [] }).join("")).toBe(JSON.stringify({ items: [] }, null, 2));
  });

  it("keeps each array row its own piece (no piece holds two pictures)", () => {
    const parts = backupParts({ files: [{ data: "A".repeat(100) }, { data: "B".repeat(100) }] });
    expect(parts.some((p) => p.includes("AAAA") && p.includes("BBBB"))).toBe(false);
  });
});

describe("readBackupJson", () => {
  it("reads what JSON.parse reads, whatever the chunk size (multi-byte letters split across chunks)", async () => {
    const text = JSON.stringify(sample, null, 2);
    for (const size of [1, 2, 3, 7, 64, 1 << 20]) {
      expect(await readBackupJson(blobOf([text]), size)).toEqual(JSON.parse(text));
    }
    const compact = JSON.stringify(sample);
    expect(await readBackupJson(blobOf([compact]), 5)).toEqual(JSON.parse(compact));
  });

  it("reads a file with a byte-order mark and spacing like JSON.parse does", async () => {
    expect(await readBackupJson(blobOf(['﻿ { "a" : [ 1 , { "b" : [ ] } ] , "c" : [ ] } \n']), 3)).toEqual({
      a: [1, { b: [] }],
      c: [],
    });
  });

  it("says it is not JSON for broken files", async () => {
    for (const bad of ["{oops", "", "[1,2]", '{"a":[1,]}', '{"a":[,1]}', '{"a":[1}', '{"a":"x', "{} {}", '{"a":[1]', '{"a":1}]']) {
      await expect(readBackupJson(blobOf([bad]), 2), bad).rejects.toBeInstanceOf(NotJsonError);
    }
  });
});
