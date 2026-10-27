import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import * as repo from "../data/repo";
import { db } from "../data/db";
import { createItem } from "../data/repo";
import { TodayPanel } from "./TodayPanel";

const TODAY = "2026-10-27"; // a Tuesday

async function task(title: string, extra: Record<string, unknown> = {}) {
  return createItem({ kind: "task", title, areaId: "writing", priority: 3, ...extra }, TODAY);
}

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const DATA_LINE = "Your data could not be read. Reload to try again.";
const SAVE_LINE = "That did not save. Try again.";

type Listener = (...args: unknown[]) => void;
// Node's process, typed locally so the app's tsconfig does not need @types/node.
const proc = (globalThis as unknown as {
  process: { on(e: string, f: Listener): void; off(e: string, f: Listener): void };
}).process;

/** Records unhandled promise rejections while a test runs. */
function watchUnhandled() {
  const seen = vi.fn();
  proc.on("unhandledRejection", seen);
  return { seen, stop: () => proc.off("unhandledRejection", seen) };
}

describe("TodayPanel", () => {
  it("shows up to 4 picks and an Also due section for the rest", async () => {
    for (let i = 1; i <= 7; i++) await task(`Late ${i}`, { due: `2026-10-${10 + i}` });
    render(<TodayPanel today={TODAY} />);
    const main = await screen.findByRole("list", { name: "Today" });
    expect(within(main).getAllByRole("listitem")).toHaveLength(4);
    const also = screen.getByText("Also due").closest("details")!;
    expect(also).not.toHaveAttribute("open");
    expect(within(also).getAllByRole("listitem")).toHaveLength(3);
    for (let i = 1; i <= 7; i++) {
      expect(screen.getAllByText(`Late ${i}`)).toHaveLength(1);
    }
  });

  it("overdue item shows an OVERDUE sticker", async () => {
    await task("Late one", { due: "2026-10-20" });
    render(<TodayPanel today={TODAY} />);
    const sticker = await screen.findByText("OVERDUE");
    expect(sticker).toHaveClass("overdue-sticker");
    expect(sticker.getAttribute("style") ?? "").toBe(""); // styles live in tokens.css, no inline colours
  });

  it("ticking calls tickItem and shows the celebration placeholder", async () => {
    const it = await task("Tick me", { priority: 1 });
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Done: Tick me" }));
    expect(await screen.findByTestId("celebration-placeholder")).toBeInTheDocument();
    expect((await db.items.get(it.id))!.status).toBe("done");
  });

  it("Move to Tomorrow removes it from Today", async () => {
    const it = await task("Move me", { pinnedDate: TODAY });
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Move: Move me" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Tomorrow" }));
    await screen.findByText("Nothing planned for today.");
    expect((await db.items.get(it.id))!.pinnedDate).toBe("2026-10-28");
  });

  describe.each([
    ["Tomorrow", "Move to Tomorrow"],
    ["This week", "Move to This week"],
    ["Remove from today", "Remove from today"],
  ])("a due-today priority-1 item: %s", (choice, what) => {
    it(`${what} removes it from the picks and from Also due`, async () => {
      // Four earlier-due items fill the picks so the target can sit in Also due too.
      for (let i = 1; i <= 4; i++) await task(`Filler ${i}`, { due: `2026-10-2${i}` });
      await task("Urgent", { due: TODAY, priority: 1 });
      render(<TodayPanel today={TODAY} />);
      const also = await screen.findByRole("list", { name: "Also due", hidden: true });
      expect(within(also).getByText("Urgent")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Move: Urgent" }));
      await userEvent.click(screen.getByRole("menuitem", { name: choice }));
      await vi.waitFor(() => expect(screen.queryByText("Urgent")).toBeNull());
      expect(screen.queryByRole("list", { name: "Also due", hidden: true })).toBeNull();
    });

    it(`${what} removes it when it is a pick`, async () => {
      await task("Urgent", { due: TODAY, priority: 1 });
      render(<TodayPanel today={TODAY} />);
      const main = await screen.findByRole("list", { name: "Today" });
      expect(within(main).getByText("Urgent")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Move: Urgent" }));
      await userEvent.click(screen.getByRole("menuitem", { name: choice }));
      await screen.findByText("Nothing planned for today.");
      expect(screen.queryByRole("list", { name: "Today" })).toBeNull();
      expect(screen.queryByText("Urgent")).toBeNull();
    });
  });

  it("empty state shows a calm message, no error", async () => {
    render(<TodayPanel today={TODAY} />);
    expect(await screen.findByText("Nothing planned for today.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Archive removes it from Today", async () => {
    const it = await task("Archive me", { pinnedDate: TODAY });
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Move: Archive me" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    await screen.findByText("Nothing planned for today.");
    expect((await db.items.get(it.id))!.status).toBe("archived");
  });

  it("never shows the empty state while the first read is pending", async () => {
    const real = await db.items.toArray();
    expect(real).toEqual([]);
    const it = await task("Pinned", { pinnedDate: TODAY });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const orig = repo.listItems;
    vi.spyOn(repo, "listItems").mockImplementationOnce(async (f) => {
      await gate;
      return orig(f);
    });
    render(<TodayPanel today={TODAY} />);
    expect(screen.queryByText("Nothing planned for today.")).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByText("Nothing planned for today.")).toBeNull();
    await act(async () => release());
    expect(await screen.findByText(it.title)).toBeInTheDocument();
    expect(screen.queryByText("Nothing planned for today.")).toBeNull();
  });

  it("a failing first read shows the calm data message and no empty-state sentence", async () => {
    vi.spyOn(repo, "listItems").mockRejectedValueOnce(new Error("disk gone"));
    render(<TodayPanel today={TODAY} />);
    expect(await screen.findByText(DATA_LINE)).toBeInTheDocument();
    expect(screen.queryByText("Nothing planned for today.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a failing move shows 'That did not save. Try again.' and does not throw an unhandled rejection", async () => {
    const watch = watchUnhandled();
    try {
      await task("Stuck", { pinnedDate: TODAY });
      vi.spyOn(repo, "moveTo").mockRejectedValueOnce(new Error("write failed"));
      render(<TodayPanel today={TODAY} />);
      await userEvent.click(await screen.findByRole("button", { name: "Move: Stuck" }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Tomorrow" }));
      expect(await screen.findByText(SAVE_LINE)).toBeInTheDocument();
      expect(screen.queryByRole("menuitem")).toBeNull(); // the menu closed
      expect(screen.getByRole("button", { name: "Move: Stuck" })).toHaveAttribute("aria-expanded", "false");
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(watch.seen).not.toHaveBeenCalled();
    } finally {
      watch.stop();
    }
  });

  it("a failing tick shows the save message, no celebration, no unhandled rejection", async () => {
    const watch = watchUnhandled();
    try {
      await task("Tick fails", { priority: 1 });
      vi.spyOn(repo, "tickItem").mockRejectedValueOnce(new Error("write failed"));
      render(<TodayPanel today={TODAY} />);
      await userEvent.click(await screen.findByRole("button", { name: "Done: Tick fails" }));
      expect(await screen.findByText(SAVE_LINE)).toBeInTheDocument();
      expect(screen.queryByTestId("celebration-placeholder")).toBeNull();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(watch.seen).not.toHaveBeenCalled();
    } finally {
      watch.stop();
    }
  });
});
