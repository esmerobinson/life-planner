import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { createItem, tickItem } from "../data/repo";
import { currentUrl, renderApp } from "../test/renderApp";

// Finding and removing repeating items: the panel's line and buttons, the Repeating page, the
// links to it. Pretend data only.
const TODAY = "2026-11-04"; // a Wednesday

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
  await db.pending.clear();
});
afterEach(() => vi.useRealTimers());

const base = { kind: "task" as const, priority: 2 as const };
const mk = (title: string, areaId: "mind" | "body" | "art" | "inbox", recur?: ("mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")[], extra = {}) =>
  createItem({ ...base, title, areaId, ...(recur ? { recur } : {}), ...extra }, "2026-10-01");

async function openPanel(id: string, path = "/area/body") {
  const title = (await db.items.get(id))!.title;
  renderApp(`${path}?open=${id}`, TODAY);
  return screen.findByRole("complementary", { name: title });
}

describe("the panel of a repeating item", () => {
  it("says what repeats and where, with the area as a link to its page", async () => {
    const h = await mk("Pretend stretch", "body", ["mon", "wed", "fri"]);
    const panel = await openPanel(h.id);
    const line = within(panel).getByText(/^Repeats Mondays, Wednesdays and Fridays/);
    expect(line.textContent).toBe("Repeats Mondays, Wednesdays and Fridays · in Body");
    const link = within(line).getByRole("link", { name: "Body" });
    expect(link).toHaveAttribute("href", "/area/body");
    expect(within(panel).getByRole("button", { name: "Stop repeating" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("shows nothing about repeating on an ordinary to-do", async () => {
    const t = await mk("Pretend one-off", "body");
    const panel = await openPanel(t.id);
    expect(within(panel).queryByText(/Repeats/)).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Stop repeating" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("an item still in the Inbox from an older import shows too, its area linking to the Inbox", async () => {
    const h = await mk("Water the pretend herbs", "inbox", ["sat"], { source: { kind: "backlog", key: "backlog:water the pretend herbs" } });
    const panel = await openPanel(h.id, "/inbox");
    expect(within(panel).getByText(/^Repeats Saturdays/).textContent).toBe("Repeats Saturdays · in Inbox");
    expect(within(panel).getByRole("link", { name: "Inbox" })).toHaveAttribute("href", "/inbox");
  });

  it("Stop repeating keeps it as a one-off to-do in its area, parks the days, and Undo puts it back", async () => {
    const h = await mk("Pretend stretch", "body", ["mon", "wed", "fri"], { doneDates: ["2026-11-02"] });
    const panel = await openPanel(h.id);
    await userEvent.click(within(panel).getByRole("button", { name: "Stop repeating" }));
    await vi.waitFor(async () => expect((await db.items.get(h.id))!.recur).toBeUndefined());
    expect(await db.items.get(h.id)).toMatchObject({
      status: "open", areaId: "body", doneDates: ["2026-11-02"], stash: { task: { recur: ["mon", "wed", "fri"] } },
    });
    // The panel stays, now offering to repeat again; the Undo line offers to take it back.
    expect(await within(panel).findByRole("button", { name: "Repeat again" })).toBeInTheDocument();
    expect(within(panel).getByText("Used to repeat Mondays, Wednesdays and Fridays")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Stop repeating" })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await vi.waitFor(async () => expect((await db.items.get(h.id))!.recur).toEqual(["mon", "wed", "fri"]));
    expect((await db.items.get(h.id))!.stash).toBeUndefined();
  });

  it("stopping a habit ticked today moves it to Done today in its area; Undo puts the open habit back", async () => {
    const h = await mk("Pretend stretch", "body", ["mon", "wed", "fri"]);
    await tickItem(h.id, TODAY);
    const panel = await openPanel(h.id);
    await userEvent.click(within(panel).getByRole("button", { name: "Stop repeating" }));
    await vi.waitFor(async () => expect(await db.items.get(h.id)).toMatchObject({ status: "done", completedAt: TODAY }));
    expect(await screen.findByText("Done (1)")).toBeInTheDocument();
    expect(await within(panel).findByRole("button", { name: "Repeat again" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await vi.waitFor(async () => expect(await db.items.get(h.id)).toMatchObject({ status: "open", recur: ["mon", "wed", "fri"] }));
    expect((await db.items.get(h.id))!.completedAt).toBeUndefined();
  });

  it("Repeat again brings the days back", async () => {
    const h = await mk("Pretend stretch", "body", ["tue"], { stash: undefined });
    const panel = await openPanel(h.id);
    await userEvent.click(within(panel).getByRole("button", { name: "Stop repeating" }));
    await userEvent.click(await within(panel).findByRole("button", { name: "Repeat again" }));
    await vi.waitFor(async () => expect((await db.items.get(h.id))!.recur).toEqual(["tue"]));
    expect((await db.items.get(h.id))!.stash).toBeUndefined();
    expect(await within(panel).findByText(/^Repeats Tuesdays/)).toBeInTheDocument();
  });

  it("Delete moves it to the Bin, history and days kept, and Undo brings it back", async () => {
    const h = await mk("Pretend stretch", "body", ["mon", "wed", "fri"], { doneDates: ["2026-11-02"] });
    const panel = await openPanel(h.id);
    await userEvent.click(within(panel).getByRole("button", { name: "Delete" }));
    await vi.waitFor(async () => expect((await db.items.get(h.id))!.status).toBe("deleted"));
    expect(await db.items.get(h.id)).toMatchObject({ recur: ["mon", "wed", "fri"], doneDates: ["2026-11-02"] });
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await vi.waitFor(async () => expect((await db.items.get(h.id))!.status).toBe("open"));
    expect(await db.items.get(h.id)).toMatchObject({ recur: ["mon", "wed", "fri"], doneDates: ["2026-11-02"] });
  });

  it("ticking it in its area only completes today; the repeat stays", async () => {
    const h = await mk("Pretend stretch", "body", ["mon", "wed", "fri"]);
    renderApp("/area/body", TODAY);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Mark done: Pretend stretch" }));
    await vi.waitFor(async () => expect((await db.items.get(h.id))!.doneDates).toEqual([TODAY]));
    expect(await db.items.get(h.id)).toMatchObject({ status: "open", recur: ["mon", "wed", "fri"] });
    expect((await db.items.get(h.id))!.stash).toBeUndefined();
  });
});

describe("the Repeating page", () => {
  it("lists every repeating item grouped by area, Mind first, the Inbox last, each with days and both buttons", async () => {
    await mk("Pretend stretch", "body", ["mon", "wed", "fri"]);
    await mk("Pretend sketch", "art", ["sun"]);
    await mk("Pretend breathing", "mind", ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
    await mk("Water the pretend herbs", "inbox", ["sat"]);
    await mk("Pretend one-off", "body");
    await mk("Pretend idea", "mind", undefined, { kind: "idea" });
    renderApp("/repeating", TODAY);
    expect(await screen.findByRole("heading", { level: 1, name: "Repeating" })).toBeInTheDocument();
    const heads = (await screen.findAllByRole("heading", { level: 2 })).map((h) => h.textContent);
    expect(heads).toEqual(["Mind", "Art", "Body", "Inbox"]);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector(".strip-title")?.textContent)).toEqual([
      "Pretend breathing", "Pretend sketch", "Pretend stretch", "Water the pretend herbs",
    ]);
    const stretch = screen.getByText("Pretend stretch").closest("li")!;
    expect(within(stretch).getByText("Mondays, Wednesdays and Fridays")).toBeInTheDocument();
    expect(within(stretch).getByRole("button", { name: "Stop repeating: Pretend stretch" })).toBeInTheDocument();
    expect(within(stretch).getByRole("button", { name: "Delete: Pretend stretch" })).toBeInTheDocument();
    expect(screen.queryByText("Pretend one-off")).toBeNull();
    expect(screen.queryByText("Pretend idea")).toBeNull();
  });

  it("says so when nothing repeats", async () => {
    await mk("Pretend one-off", "body");
    renderApp("/repeating", TODAY);
    expect(await screen.findByText("Nothing repeats.")).toBeInTheDocument();
  });

  it("Stop repeating takes the row off the list and keeps the item; Undo brings the row back", async () => {
    const h = await mk("Pretend stretch", "body", ["mon"], { doneDates: ["2026-11-03"] });
    renderApp("/repeating", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Stop repeating: Pretend stretch" }));
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Stop repeating: Pretend stretch" })).toBeNull());
    expect(await db.items.get(h.id)).toMatchObject({ areaId: "body", status: "open", doneDates: ["2026-11-03"] });
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("button", { name: "Stop repeating: Pretend stretch" })).toBeInTheDocument();
  });

  it("Delete moves it to the Bin with Undo", async () => {
    const h = await mk("Pretend stretch", "body", ["mon"]);
    renderApp("/repeating", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Delete: Pretend stretch" }));
    await vi.waitFor(async () => expect((await db.items.get(h.id))!.status).toBe("deleted"));
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await vi.waitFor(async () => expect((await db.items.get(h.id))!.status).toBe("open"));
    expect(await screen.findByText("Pretend stretch")).toBeInTheDocument();
  });

  it("a title opens the item in the side panel", async () => {
    const h = await mk("Pretend stretch", "body", ["mon"]);
    renderApp("/repeating", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Pretend stretch" }));
    expect(currentUrl).toBe(`/repeating?open=${h.id}`);
    expect(await screen.findByRole("complementary", { name: "Pretend stretch" })).toBeInTheDocument();
  });

  it("a done day on the item stays after it is stopped (its history)", async () => {
    const h = await mk("Pretend stretch", "body", ["mon", "wed"]);
    await tickItem(h.id, TODAY);
    renderApp("/repeating", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Stop repeating: Pretend stretch" }));
    await vi.waitFor(async () => expect((await db.items.get(h.id))!.recur).toBeUndefined());
    expect((await db.items.get(h.id))!.doneDates).toEqual([TODAY]);
  });
});

describe("how to get there", () => {
  it("the footer links include Repeating", async () => {
    renderApp("/", TODAY);
    const link = await screen.findByRole("link", { name: "Repeating" });
    expect(link).toHaveAttribute("href", "/repeating");
  });

  it("each area's Habits box ends with a Manage repeats link", async () => {
    await mk("Pretend stretch", "body", ["mon"]);
    renderApp("/area/body", TODAY);
    const box = await screen.findByRole("region", { name: "Habits" });
    const link = within(box).getByRole("link", { name: "Manage repeats" });
    expect(link).toHaveAttribute("href", "/repeating");
    // It is the last thing in the box.
    expect(box.lastElementChild).toContainElement(link);
  });
});
