import { newId } from "./ids";

describe("newId", () => {
  it("is a version-7 UUID", () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("sorts in the order the ids were made, also within one millisecond and if the clock steps back", () => {
    const t = 1_800_000_000_000;
    const ids = [newId(t), newId(t), newId(t), newId(t - 5000), newId(t + 1), newId(t + 60_000)];
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]!.slice(0, 13).replace("-", "")).toBe(t.toString(16).padStart(12, "0"));
  });
});
