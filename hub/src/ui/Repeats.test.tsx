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
    // Stop repeating and Delete wait in the row's "…" menu (Esme's pick 1·2 A, 2026-11-17).
    expect(within(stretch).queryByRole("button", { name: "Stop repeating: Pretend stretch" })).toBeNull();
    await userEvent.click(within(stretch).getByRole("button", { name: "More: Pretend stretch" }));
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
    await openMenu("Pretend stretch");
    await userEvent.click(await screen.findByRole("button", { name: "Stop repeating: Pretend stretch" }));
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "More: Pretend stretch" })).toBeNull());
    expect(await db.items.get(h.id)).toMatchObject({ areaId: "body", status: "open", doneDates: ["2026-11-03"] });
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("button", { name: "More: Pretend stretch" })).toBeInTheDocument();
  });

  it("Delete moves it to the Bin with Undo", async () => {
    const h = await mk("Pretend stretch", "body", ["mon"]);
    renderApp("/repeating", TODAY);
    await openMenu("Pretend stretch");
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
    await openMenu("Pretend stretch");
    await userEvent.click(await screen.findByRole("button", { name: "Stop repeating: Pretend stretch" }));
    await vi.waitFor(async () => expect((await db.items.get(h.id))!.recur).toBeUndefined());
    expect((await db.items.get(h.id))!.doneDates).toEqual([TODAY]);
  });
});

/** Opens a row's "…" menu (Stop repeating, Delete). */
async function openMenu(title: string) {
  await userEvent.click(await screen.findByRole("button", { name: `More: ${title}` }));
}

/** A row's seven day buttons, Monday first. */
async function dayButtons(title: string) {
  const group = await screen.findByRole("group", { name: `Repeats on: ${title}` });
  return within(group).getAllByRole("button");
}

describe("changing the days on the Repeating page (Esme's pick 1·2 A, 2026-11-17)", () => {
  it("every row shows M T W T F S S, the repeat's days pressed", async () => {
    await mk("Pretend stretch", "body", ["mon", "wed", "fri"]);
    renderApp("/repeating", TODAY);
    const days = await dayButtons("Pretend stretch");
    expect(days.map((d) => d.textContent)).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
    expect(days.map((d) => d.getAttribute("aria-label"))).toEqual([
      "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    ]);
    expect(days.map((d) => d.getAttribute("aria-pressed"))).toEqual(["true", "false", "true", "false", "true", "false", "false"]);
  });

  it("a tap switches a day on or off and saves at once, in Monday-first order; the rest of the item is untouched", async () => {
    const h = await mk("Pretend stretch", "body", ["wed"], { doneDates: ["2026-11-03"], notes: "Pretend note" });
    renderApp("/repeating", TODAY);
    const days = await dayButtons("Pretend stretch");
    await userEvent.click(days[6]); // Sunday on
    await userEvent.click(days[0]); // Monday on
    await vi.waitFor(async () => expect((await db.items.get(h.id))!.recur).toEqual(["mon", "wed", "sun"]));
    await userEvent.click(days[2]); // Wednesday off
    await vi.waitFor(async () => expect((await db.items.get(h.id))!.recur).toEqual(["mon", "sun"]));
    expect(await db.items.get(h.id)).toMatchObject({ status: "open", doneDates: ["2026-11-03"], notes: "Pretend note", areaId: "body" });
    expect((await dayButtons("Pretend stretch")).map((d) => d.getAttribute("aria-pressed"))).toEqual([
      "true", "false", "false", "false", "false", "false", "true",
    ]);
  });

  it("the last day on can't be switched off: it stays, and the row says why", async () => {
    const h = await mk("Pretend stretch", "body", ["sat"]);
    renderApp("/repeating", TODAY);
    await userEvent.click((await dayButtons("Pretend stretch"))[5]);
    expect(await screen.findByText(/It has to repeat on at least one day/)).toBeInTheDocument();
    expect((await dayButtons("Pretend stretch"))[5]).toHaveAttribute("aria-pressed", "true");
    expect((await db.items.get(h.id))!.recur).toEqual(["sat"]);
    // Switching another day on clears the message.
    await userEvent.click((await dayButtons("Pretend stretch"))[0]);
    await vi.waitFor(() => expect(screen.queryByText(/It has to repeat on at least one day/)).toBeNull());
    await vi.waitFor(async () => expect((await db.items.get(h.id))!.recur).toEqual(["mon", "sat"]));
  });
});

describe("the Repeating page's week (Esme's pick 1·3 A, 2026-11-17)", () => {
  it("This week shows Monday to Sunday, each repeat on its days with its area tile, today outlined and ticked ones crossed out", async () => {
    const walk = await mk("Pretend walk", "body", ["mon", "wed", "fri"]);
    await mk("Pretend sketch", "art", ["tue", "thu"]);
    await mk("Water the pretend herbs", "inbox", ["sat"]);
    await tickItem(walk.id, TODAY);
    renderApp("/repeating", TODAY);
    const byArea = await screen.findByRole("button", { name: "By area" });
    expect(byArea).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(screen.getByRole("button", { name: "This week" })).toHaveAttribute("aria-pressed", "true");
    const cols = document.querySelectorAll(".week-day");
    expect([...cols].map((c) => c.querySelector("h2")!.textContent)).toEqual([
      "Mon 2", "Tue 3", "Wed 4 · today", "Thu 5", "Fri 6", "Sat 7", "Sun 8",
    ]);
    expect([...cols].map((c) => c.classList.contains("is-today"))).toEqual([false, false, true, false, false, false, false]);
    const titles = (i: number) => [...cols[i].querySelectorAll(".week-title")].map((t) => t.textContent);
    expect(titles(0)).toEqual(["Pretend walk"]);
    expect(titles(1)).toEqual(["Pretend sketch"]);
    expect(titles(5)).toEqual(["Water the pretend herbs"]);
    expect(titles(6)).toEqual([]);
    // Ticked today: crossed out in today's column only.
    expect(cols[2].querySelector(".week-mini")).toHaveClass("crossed");
    expect(cols[0].querySelector(".week-mini")).not.toHaveClass("crossed");
    // The area tile: Body's colour; the Inbox's own tile for the older import.
    expect((cols[0].querySelector(".week-tile") as HTMLElement).style.background).toBe("rgb(227, 152, 118)");
    expect((cols[5].querySelector(".week-tile") as HTMLElement).style.background).toBe("rgb(212, 209, 195)");
    // A strip opens the item in the side panel.
    await userEvent.click(within(cols[1] as HTMLElement).getByRole("button", { name: "Pretend sketch" }));
    expect(await screen.findByRole("complementary", { name: "Pretend sketch" })).toBeInTheDocument();
  });

  it("a day changed in By area shows in This week", async () => {
    await mk("Pretend walk", "body", ["mon"]);
    renderApp("/repeating", TODAY);
    await userEvent.click((await dayButtons("Pretend walk"))[6]);
    await userEvent.click(screen.getByRole("button", { name: "This week" }));
    await vi.waitFor(() => expect(document.querySelectorAll(".week-day")[6].textContent).toContain("Pretend walk"));
  });
});

describe("how to get there", () => {
  it("Repeating has its own sidebar row under Goals, and is no longer a footer link (Esme's pick A, 2026-11-17)", async () => {
    renderApp("/", TODAY);
    const main = await screen.findByRole("navigation", { name: "Main" });
    const links = within(main).getAllByRole("link");
    const at = links.findIndex((l) => l.textContent === "Repeating");
    expect(links[at]).toHaveAttribute("href", "/repeating");
    expect(links[at - 1]).toHaveTextContent("Goals");
    expect(screen.getAllByRole("link", { name: "Repeating" })).toHaveLength(1);
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
