import { renderHook, waitFor } from "@testing-library/react";
import { db } from "../data/db";
import { useFarmItems } from "./FarmContext";

// The farm reads every item (archived ones too) for its counters. Before she has opened the farm
// it needs none of them, and must not re-read the whole table after every write (a thousand
// quick writes, an import say, would each cost a full read).

beforeEach(async () => {
  await db.items.clear();
  await db.items.put({
    id: "f1", kind: "task", title: "Pretend task", links: [], areaId: "mind", priority: 2, status: "archived",
    createdAt: "2026-11-01", touchedAt: "2026-11-02",
  });
});

it("reads nothing before the farm has started", async () => {
  const spy = vi.spyOn(db.items, "filter");
  const { result } = renderHook(() => useFarmItems(false));
  await new Promise((r) => setTimeout(r, 50));
  expect(result.current).toEqual([]);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});

it("once started, reads every item that isn't in the Bin, archived ones too", async () => {
  const { result } = renderHook(() => useFarmItems(true));
  await waitFor(() => expect(result.current.map((i) => i.id)).toEqual(["f1"]));
});
