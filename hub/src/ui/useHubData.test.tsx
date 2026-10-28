import { act, renderHook, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import * as repo from "../data/repo";
import Dexie from "dexie";
import { db, HubDB } from "../data/db";
import type { Item } from "../domain/types";
import { useHubData } from "./useHubData";

const TODAY = "2026-10-27";

function mk(title: string): Item {
  return {
    id: title,
    kind: "task",
    title,
    links: [],
    areaId: "writing",
    priority: 3,
    status: "open",
    createdAt: TODAY,
    touchedAt: TODAY,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useHubData", () => {
  it("is not loaded until the first read completes", async () => {
    const first = deferred<Item[]>();
    vi.spyOn(repo, "listItems").mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useHubData(TODAY));
    expect(result.current.loaded).toBe(false);
    await act(async () => first.resolve([]));
    await waitFor(() => expect(result.current.loaded).toBe(true));
  });

  it("ignores an older refresh that resolves after a newer one", async () => {
    const older = deferred<Item[]>();
    const newer = deferred<Item[]>();
    const spy = vi.spyOn(repo, "listItems");
    spy.mockReturnValueOnce(Promise.resolve([])); // mount read
    const { result } = renderHook(() => useHubData(TODAY));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    spy.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    let p1!: Promise<void>;
    let p2!: Promise<void>;
    act(() => {
      p1 = result.current.refresh();
      p2 = result.current.refresh();
    });
    await act(async () => {
      newer.resolve([mk("newer")]);
      await p2;
    });
    await act(async () => {
      older.resolve([mk("older")]);
      await p1;
    });
    expect(result.current.items.map((i) => i.title)).toEqual(["newer"]);
  });

  it("does not update state after unmount", async () => {
    const slow = deferred<Item[]>();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repo, "listItems").mockReturnValueOnce(slow.promise);
    const { result, unmount } = renderHook(() => useHubData(TODAY));
    unmount();
    await act(async () => slow.resolve([mk("late")]));
    expect(result.current.items).toEqual([]);
    expect(result.current.loaded).toBe(false);
    expect(err).not.toHaveBeenCalled();
  });

  it("a failed read sets error and loaded; a later good read clears error", async () => {
    const spy = vi.spyOn(repo, "listItems").mockRejectedValueOnce(new Error("nope"));
    const { result } = renderHook(() => useHubData(TODAY));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.error).toBe("Your data could not be read. Reload to try again.");
    spy.mockResolvedValueOnce([mk("back")]);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.items.map((i) => i.title)).toEqual(["back"]);
  });

  describe("cross-tab freshness", () => {
    it("a write from a second Dexie connection triggers a re-read in the hook", async () => {
      const other = new HubDB();
      const { result } = renderHook(() => useHubData(TODAY));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      await other.items.put(mk("external"));
      await waitFor(() => expect(result.current.items.map((i) => i.title)).toEqual(["external"]));
      other.close();
    });

    it("the subscription is removed on unmount", async () => {
      const unsub = vi.spyOn(Dexie.on.storagemutated, "unsubscribe");
      const { result, unmount } = renderHook(() => useHubData(TODAY));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      unmount();
      expect(unsub).toHaveBeenCalled();
      const spy = vi.spyOn(repo, "listItems");
      const other = new HubDB();
      await other.items.put(mk("after-unmount"));
      await new Promise((r) => setTimeout(r, 50));
      expect(spy).not.toHaveBeenCalled();
      other.close();
    });

    it("two rapid external writes produce a final state containing both", async () => {
      const other = new HubDB();
      const { result } = renderHook(() => useHubData(TODAY));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      await Promise.all([other.items.put(mk("a")), other.items.put(mk("b"))]);
      await waitFor(() =>
        expect(result.current.items.map((i) => i.title).sort()).toEqual(["a", "b"]),
      );
      other.close();
    });

    it("a local write causes a bounded number of reads (no loop)", async () => {
      const spy = vi.spyOn(repo, "listItems");
      const { result } = renderHook(() => useHubData(TODAY));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      spy.mockClear();
      await db.items.put(mk("local"));
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      await new Promise((r) => setTimeout(r, 100));
      expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it("an external change while a slower older read is in flight does not let the older result overwrite the newer", async () => {
      const older = deferred<Item[]>();
      const spy = vi.spyOn(repo, "listItems");
      spy.mockReturnValueOnce(Promise.resolve([])); // mount read
      const other = new HubDB();
      const { result } = renderHook(() => useHubData(TODAY));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      spy.mockReturnValueOnce(older.promise); // slow read, started by a manual refresh
      let p!: Promise<void>;
      act(() => {
        p = result.current.refresh();
      });
      await other.items.put(mk("fresh")); // external event -> newer real read
      await waitFor(() => expect(result.current.items.map((i) => i.title)).toEqual(["fresh"]));
      await act(async () => {
        older.resolve([mk("stale")]);
        await p;
      });
      expect(result.current.items.map((i) => i.title)).toEqual(["fresh"]);
      other.close();
    });
  });
});
