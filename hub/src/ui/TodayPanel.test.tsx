import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    expect(await screen.findByText("OVERDUE")).toBeInTheDocument();
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
});
