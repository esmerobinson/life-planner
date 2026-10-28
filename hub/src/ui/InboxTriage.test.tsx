import { fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import * as repo from "../data/repo";
import { createItem } from "../data/repo";
import type { Item } from "../domain/types";
import { inboxSource } from "./inboxSource";
import { InboxPage } from "./InboxPage";
import { ShellContext } from "./shellContext";

const TODAY = "2026-10-28";

/** The Inbox links to Sort one by one, so it renders inside a router. */
const render = (ui: ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

type Seed = { title: string; tags?: string[]; source?: Item["source"] };
async function seed(...rows: Seed[]) {
  for (const r of rows) {
    await createItem({ kind: "task", areaId: "inbox", priority: 2, ...r }, TODAY);
  }
}
const backlog = (title: string): Seed => ({ title, source: { kind: "backlog", key: `backlog:${title.toLowerCase()}` } });
const gtask = (title: string): Seed => ({ title, source: { kind: "gtasks", key: `gtasks:${title}` } });

const box = () => screen.getByRole("textbox", { name: "Add to inbox" });
const rowOf = (title: string) => screen.getByText(title, { selector: ".strip-title" }).closest("li") as HTMLElement;

describe("quick capture", () => {
  it("is the first thing under the heading, above To sort", async () => {
    render(<InboxPage today={TODAY} />);
    await screen.findByText("Nothing waiting in the inbox.");
    const form = box().closest("form")!;
    const toSort = screen.getByRole("heading", { name: "To sort" });
    expect(form.compareDocumentPosition(toSort) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add this to the inbox" })).toHaveClass("btn-secondary");
  });

  it("Enter adds a trimmed inbox task, clears the box and keeps focus", async () => {
    render(<InboxPage today={TODAY} />);
    await userEvent.type(box(), "  Buy stamps  {Enter}");
    const list = await screen.findByRole("list", { name: "Inbox items" });
    expect(list).toHaveTextContent("Buy stamps");
    const [row] = await db.items.toArray();
    expect(row).toMatchObject({ kind: "task", title: "Buy stamps", areaId: "inbox", priority: 2, status: "open" });
    expect(box()).toHaveValue("");
    expect(box()).toHaveFocus();
  });

  it("three entries in a row add three items", async () => {
    render(<InboxPage today={TODAY} />);
    await userEvent.type(box(), "one{Enter}two{Enter}three{Enter}");
    await vi.waitFor(async () => expect(await db.items.count()).toBe(3));
    expect((await db.items.toArray()).map((i) => i.title).sort()).toEqual(["one", "three", "two"]);
    await vi.waitFor(() => expect(screen.getByRole("list", { name: "Inbox items" })).toHaveTextContent("three"));
  });

  it("the Add button adds too; a double click adds once", async () => {
    render(<InboxPage today={TODAY} />);
    fireEvent.change(box(), { target: { value: "Once only" } });
    const btn = screen.getByRole("button", { name: "Add this to the inbox" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await vi.waitFor(async () => expect(await db.items.count()).toBe(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(await db.items.count()).toBe(1);
  });

  it("a blank entry is ignored silently", async () => {
    render(<InboxPage today={TODAY} />);
    await userEvent.type(box(), "   {Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Add this to the inbox" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(await db.items.count()).toBe(0);
    expect(document.querySelector(".form-message")).toBeNull();
  });

  it("tells the shell, so the count updates", async () => {
    const refresh = vi.fn();
    render(
      <ShellContext.Provider value={{ refresh, version: 0, today: TODAY }}>
        <InboxPage today={TODAY} />
      </ShellContext.Provider>,
    );
    await userEvent.type(box(), "Counted{Enter}");
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows the calm save message when the write fails", async () => {
    const spy = vi.spyOn(repo, "createItem").mockRejectedValue(new Error("boom"));
    try {
      render(<InboxPage today={TODAY} />);
      await userEvent.type(box(), "Lost{Enter}");
      expect(await screen.findByText("That did not save. Try again.")).toBeInTheDocument();
      // the thought is given back, not lost
      expect(box()).toHaveValue("Lost");
    } finally {
      spy.mockRestore();
    }
    expect(await db.items.count()).toBe(0);
  });

  it("the import panels are no longer on the Inbox page", async () => {
    render(<InboxPage today={TODAY} />);
    await screen.findByText("Nothing waiting in the inbox.");
    expect(screen.queryByLabelText("Backlog text")).toBeNull();
    expect(screen.queryByLabelText("Google Tasks text")).toBeNull();
  });
});

describe("From filter", () => {
  it("is hidden when everything comes from one source", async () => {
    await seed(backlog("One"), backlog("Two"));
    render(<InboxPage today={TODAY} />);
    await screen.findByText("One", { selector: ".strip-title" });
    expect(screen.queryByRole("group", { name: "From" })).toBeNull();
  });

  it("derives one pill per source present, plus All (pressed by default)", async () => {
    await seed(backlog("Ba"), gtask("Gt"), { title: "Plain" });
    render(<InboxPage today={TODAY} />);
    const group = await screen.findByRole("group", { name: "From" });
    expect(group).toHaveClass("btn-group");
    const pills = within(group).getAllByRole("button");
    expect(pills.map((p) => p.textContent)).toEqual(["All", "Backlog", "Google Tasks", "Other"]);
    expect(within(group).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Backlog" })).toHaveAttribute("aria-pressed", "false");
  });

  it("choosing a source shows only its rows; All brings them back", async () => {
    await seed(backlog("Ba"), gtask("Gt"));
    render(<InboxPage today={TODAY} />);
    const group = await screen.findByRole("group", { name: "From" });
    await userEvent.click(within(group).getByRole("button", { name: "Google Tasks" }));
    expect(within(group).getByRole("button", { name: "Google Tasks" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Ba", { selector: ".strip-title" })).toBeNull();
    expect(screen.getByText("Gt", { selector: ".strip-title" })).toBeInTheDocument();
    await userEvent.click(within(group).getByRole("button", { name: "All" }));
    expect(screen.getByText("Ba", { selector: ".strip-title" })).toBeInTheDocument();
  });

  it("vault-review tags choose the source, ahead of the source kind", () => {
    const base: Item = { id: "x", kind: "task", title: "t", links: [], areaId: "inbox", priority: 2, status: "open", createdAt: TODAY, touchedAt: TODAY };
    const o = { kind: "obsidian", key: "k" } as const;
    expect(inboxSource({ ...base, tags: ["from-daily-notes"], source: o })).toBe("Daily notes");
    expect(inboxSource({ ...base, tags: ["x", "from-old-task-lists"] })).toBe("Old task lists");
    expect(inboxSource({ ...base, tags: ["from-project-notes"], source: { kind: "backlog", key: "k" } })).toBe("Projects");
    expect(inboxSource({ ...base, source: { kind: "backlog", key: "k" } })).toBe("Backlog");
    expect(inboxSource({ ...base, source: { kind: "gtasks", key: "k" } })).toBe("Google Tasks");
    expect(inboxSource({ ...base, source: { kind: "manual", key: "k" } })).toBe("Other");
    expect(inboxSource(base)).toBe("Other");
  });

  it("shows the vault-review pills when those tags are present", async () => {
    await seed(
      { title: "D", tags: ["from-daily-notes"] },
      { title: "O", tags: ["from-old-task-lists"] },
      { title: "P", tags: ["from-project-notes"] },
    );
    render(<InboxPage today={TODAY} />);
    const group = await screen.findByRole("group", { name: "From" });
    expect(within(group).getAllByRole("button").map((p) => p.textContent)).toEqual([
      "All", "Daily notes", "Old task lists", "Projects",
    ]);
  });

  it("once a chosen source has emptied, it does not come back filtered when items return", async () => {
    await seed(backlog("Ba"), gtask("Gt"), { title: "Plain" });
    render(<InboxPage today={TODAY} />);
    const group = await screen.findByRole("group", { name: "From" });
    await userEvent.click(within(group).getByRole("button", { name: "Backlog" }));
    await userEvent.click(screen.getByRole("button", { name: "Move to: Ba" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Move Ba to" })).getByRole("button", { name: "Archive" }));
    await screen.findByText("Archived from the inbox (1)", { selector: "summary" });
    await userEvent.click(screen.getByRole("button", { name: "Restore: Ba" }));
    const again = await screen.findByRole("group", { name: "From" });
    expect(within(again).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Gt", { selector: ".strip-title" })).toBeInTheDocument();
    expect(screen.getByText("Plain", { selector: ".strip-title" })).toBeInTheDocument();
  });

  it("falls back to All when the chosen source has nothing left", async () => {
    await seed(backlog("Ba"), gtask("Gt"));
    render(<InboxPage today={TODAY} />);
    const group = await screen.findByRole("group", { name: "From" });
    await userEvent.click(within(group).getByRole("button", { name: "Backlog" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete: Ba" }));
    await vi.waitFor(() => expect(screen.queryByRole("group", { name: "From" })).toBeNull());
    expect(screen.getByText("Gt", { selector: ".strip-title" })).toBeInTheDocument();
  });
});

describe("check reasons", () => {
  it("shows the reason line under the title when the item has the check tag", async () => {
    await createItem(
      { kind: "task", title: "Maybe done", areaId: "inbox", priority: 2, tags: ["check"], notes: "Check: not sure if this is still open\nmore detail" },
      TODAY,
    );
    await createItem(
      { kind: "task", title: "Plain", areaId: "inbox", priority: 2, notes: "Check: this should not show" },
      TODAY,
    );
    render(<InboxPage today={TODAY} />);
    await screen.findByText("Maybe done", { selector: ".strip-title" });
    expect(within(rowOf("Maybe done")).getByText("Check: not sure if this is still open")).toBeInTheDocument();
    expect(screen.queryByText("more detail")).toBeNull();
    expect(screen.queryByText("Check: this should not show")).toBeNull();
  });

  it("shows nothing extra when the check tag has no reason line, and renders the reason as text", async () => {
    await createItem({ kind: "task", title: "Tagged", areaId: "inbox", priority: 2, tags: ["check"] }, TODAY);
    await createItem(
      { kind: "task", title: "Html", areaId: "inbox", priority: 2, tags: ["check"], notes: "Check: <b>idea</b> or to-do?" },
      TODAY,
    );
    render(<InboxPage today={TODAY} />);
    await screen.findByText("Tagged", { selector: ".strip-title" });
    expect(document.querySelectorAll(".inbox-check")).toHaveLength(1);
    expect(screen.getByText("Check: <b>idea</b> or to-do?")).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });
});
