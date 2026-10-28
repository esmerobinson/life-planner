import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import * as repo from "../data/repo";
import { createGoal, createItem } from "../data/repo";
import type { Item } from "../domain/types";
import { inboxSource } from "./inboxSource";
import { InboxPage } from "./InboxPage";
import { ShellContext } from "./shellContext";

const TODAY = "2026-10-28";

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
const rowOf = (title: string) =>
  screen.getByRole("checkbox", { name: `Select ${title}` }).closest("li") as HTMLElement;

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

describe("one-tap area buttons and More options", () => {
  it("each row has a button per area with an accessible name, in a pill group", async () => {
    await seed({ title: "Loose" });
    render(<InboxPage today={TODAY} />);
    await screen.findByRole("checkbox", { name: "Select Loose" });
    const group = within(rowOf("Loose")).getByRole("group", { name: "File Loose in" });
    expect(group).toHaveClass("btn-group");
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(
      ["Writing", "Art", "Content", "Mind", "Body", "Tech projects", "Production", "Admin"].map((a) => `File Loose in ${a}`),
    );
    expect(buttons.every((b) => b.classList.contains("btn-secondary"))).toBe(true);
    expect(buttons.map((b) => b.textContent)).toContain("Tech projects");
  });

  it("one tap files the item and the row leaves the list", async () => {
    await seed({ title: "Loose" }, { title: "Stays" });
    render(<InboxPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "File Loose in Art" }));
    await vi.waitFor(() => expect(screen.queryByRole("checkbox", { name: "Select Loose" })).toBeNull());
    expect(screen.getByRole("checkbox", { name: "Select Stays" })).toBeInTheDocument();
    const got = (await db.items.filter((i) => i.title === "Loose").first())!;
    expect(got).toMatchObject({ areaId: "art", touchedAt: TODAY, priority: 2 });
  });

  it("one tap tells the shell", async () => {
    await seed({ title: "Loose" });
    const refresh = vi.fn();
    render(
      <ShellContext.Provider value={{ refresh, version: 0, today: TODAY }}>
        <InboxPage today={TODAY} />
      </ShellContext.Provider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "File Loose in Body" }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("a failed tap shows the calm message and keeps the row", async () => {
    await seed({ title: "Loose" });
    render(<InboxPage today={TODAY} />);
    const btn = await screen.findByRole("button", { name: "File Loose in Art" });
    const spy = vi.spyOn(db.items, "update").mockRejectedValue(new Error("boom"));
    await userEvent.click(btn);
    expect(await screen.findByText("That did not save. Try again.")).toBeInTheDocument();
    spy.mockRestore();
    expect((await db.items.toArray())[0].areaId).toBe("inbox");
  });

  it("the detailed controls sit in a collapsed More options and still file with goal, priority and due", async () => {
    await createGoal({ title: "Zine", areaId: "writing", kind: "practice" }, TODAY);
    await seed({ title: "Loose" });
    render(<InboxPage today={TODAY} />);
    await screen.findByRole("checkbox", { name: "Select Loose" });
    const summary = within(rowOf("Loose")).getByText("More options", { selector: "summary" });
    const details = summary.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    for (const l of ["Area for Loose", "Goal for Loose", "Priority for Loose", "Due for Loose"]) {
      expect(within(details).getByLabelText(l)).toBeInTheDocument();
    }
    expect(within(details).getByRole("button", { name: "File Loose" })).toBeInTheDocument();
    // The default view is just the title and the area buttons.
    expect(within(rowOf("Loose")).getByRole("button", { name: "File Loose in Art" }).closest("details")).toBeNull();

    await userEvent.click(summary);
    await userEvent.selectOptions(within(details).getByLabelText("Area for Loose"), "writing");
    await userEvent.selectOptions(within(details).getByLabelText("Goal for Loose"), "Zine");
    await userEvent.selectOptions(within(details).getByLabelText("Priority for Loose"), "3");
    fireEvent.change(within(details).getByLabelText("Due for Loose"), { target: { value: "2026-11-05" } });
    await userEvent.click(within(details).getByRole("button", { name: "File Loose" }));
    await vi.waitFor(async () => expect((await db.items.toArray())[0].areaId).toBe("writing"));
    const got = (await db.items.toArray())[0];
    expect(got).toMatchObject({ priority: 3, due: "2026-11-05" });
    expect(got.goalId).toBeTruthy();
  });
});

describe("Archive selected", () => {
  it("is disabled until something is selected", async () => {
    await seed({ title: "A" });
    render(<InboxPage today={TODAY} />);
    const btn = await screen.findByRole("button", { name: "Archive selected" });
    expect(btn).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select A" }));
    expect(btn).toBeEnabled();
  });

  it("archives the selection, never deletes, says so, and lists them to restore", async () => {
    await seed({ title: "A" }, { title: "B" }, { title: "C" });
    render(<InboxPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select A" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select B" }));
    await userEvent.click(screen.getByRole("button", { name: "Archive selected" }));
    expect(
      await screen.findByText("Archived 2. You can restore them under Archived from the inbox, below."),
    ).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByRole("checkbox", { name: "Select A" })).toBeNull());
    expect(screen.getByRole("checkbox", { name: "Select C" })).toBeInTheDocument();
    const all = await db.items.toArray();
    expect(all).toHaveLength(3);
    expect(all.filter((i) => i.status === "archived").map((i) => i.title).sort()).toEqual(["A", "B"]);

    const details = screen.getByText("Archived from the inbox (2)", { selector: "summary" }).closest("details")!;
    expect(details).not.toHaveAttribute("open");
    await userEvent.click(within(details).getByRole("button", { name: "Restore: A" }));
    await screen.findByRole("checkbox", { name: "Select A" });
    expect((await db.items.filter((i) => i.title === "A").first())!.status).toBe("open");
    expect(screen.getByText("Archived from the inbox (1)", { selector: "summary" })).toBeInTheDocument();
  });

  it("double-clicking archives once", async () => {
    await seed({ title: "A" }, { title: "B" });
    render(<InboxPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    const spy = vi.spyOn(repo, "archiveItems");
    const btn = screen.getByRole("button", { name: "Archive selected" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await screen.findByText("Nothing waiting in the inbox.");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("a failing archive shows the calm message and archives nothing", async () => {
    await seed({ title: "A" }, { title: "B" });
    render(<InboxPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    const real = db.items.update.bind(db.items);
    let n = 0;
    const spy = vi.spyOn(db.items, "update").mockImplementation(((...a: Parameters<typeof real>) => {
      if (++n === 2) throw new Error("boom");
      return real(...a);
    }) as never);
    await userEvent.click(screen.getByRole("button", { name: "Archive selected" }));
    expect(await screen.findByText("That did not save. Try again.")).toBeInTheDocument();
    spy.mockRestore();
    expect((await db.items.toArray()).every((i) => i.status === "open")).toBe(true);
  });
});

describe("From filter", () => {
  it("is hidden when everything comes from one source", async () => {
    await seed(backlog("One"), backlog("Two"));
    render(<InboxPage today={TODAY} />);
    await screen.findByRole("checkbox", { name: "Select One" });
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
    expect(screen.queryByRole("checkbox", { name: "Select Ba" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Select Gt" })).toBeInTheDocument();
    await userEvent.click(within(group).getByRole("button", { name: "All" }));
    expect(screen.getByRole("checkbox", { name: "Select Ba" })).toBeInTheDocument();
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

  it("Select all shown and the bulk actions respect the filter", async () => {
    await seed(backlog("Ba1"), backlog("Ba2"), gtask("Gt"));
    render(<InboxPage today={TODAY} />);
    const group = await screen.findByRole("group", { name: "From" });
    await userEvent.click(within(group).getByRole("button", { name: "Backlog" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all shown" }));
    expect(screen.getByRole("checkbox", { name: "Select Ba1" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Archive selected" }));
    await vi.waitFor(async () =>
      expect((await db.items.toArray()).filter((i) => i.status === "archived").map((i) => i.title).sort()).toEqual(["Ba1", "Ba2"]),
    );
    expect((await db.items.filter((i) => i.title === "Gt").first())!.status).toBe("open");
  });

  it("changing the filter drops selections that are no longer shown", async () => {
    await seed(backlog("Ba"), gtask("Gt"));
    render(<InboxPage today={TODAY} />);
    const group = await screen.findByRole("group", { name: "From" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Ba" }));
    await userEvent.click(within(group).getByRole("button", { name: "Google Tasks" }));
    expect(screen.getByRole("button", { name: "Archive selected" })).toBeDisabled();
    await userEvent.click(within(group).getByRole("button", { name: "All" }));
    expect(screen.getByRole("checkbox", { name: "Select Ba" })).not.toBeChecked();
  });

  it("once a chosen source has emptied, it does not come back filtered when items return", async () => {
    await seed(backlog("Ba"), gtask("Gt"), { title: "Plain" });
    render(<InboxPage today={TODAY} />);
    const group = await screen.findByRole("group", { name: "From" });
    await userEvent.click(within(group).getByRole("button", { name: "Backlog" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Ba" }));
    await userEvent.click(screen.getByRole("button", { name: "Archive selected" }));
    await screen.findByText("Archived from the inbox (1)", { selector: "summary" });
    await userEvent.click(screen.getByRole("button", { name: "Restore: Ba" }));
    const again = await screen.findByRole("group", { name: "From" });
    expect(within(again).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: "Select Gt" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Plain" })).toBeInTheDocument();
  });

  it("falls back to All when the chosen source has nothing left", async () => {
    await seed(backlog("Ba"), gtask("Gt"));
    render(<InboxPage today={TODAY} />);
    const group = await screen.findByRole("group", { name: "From" });
    await userEvent.click(within(group).getByRole("button", { name: "Backlog" }));
    await userEvent.click(screen.getByRole("button", { name: "File Ba in Art" }));
    await vi.waitFor(() => expect(screen.queryByRole("group", { name: "From" })).toBeNull());
    expect(screen.getByRole("checkbox", { name: "Select Gt" })).toBeInTheDocument();
  });
});

describe("type control and Make it a goal (inside More options)", () => {
  const more = (title: string) =>
    within(rowOf(title)).getByText("More options", { selector: "summary" }).closest("details") as HTMLElement;

  it("offers To-do and Idea toggle pills, reflecting the item's kind", async () => {
    await seed({ title: "Loose" });
    render(<InboxPage today={TODAY} />);
    await screen.findByRole("checkbox", { name: "Select Loose" });
    const group = within(more("Loose")).getByRole("group", { name: "This is a:" });
    expect(group).toHaveClass("btn-group");
    expect(within(group).getByRole("button", { name: "To-do" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Idea" })).toHaveAttribute("aria-pressed", "false");
  });

  it("choosing Idea saves the kind, drops due and recur, and keeps the row in the inbox", async () => {
    await createItem(
      { kind: "task", title: "Loose", areaId: "inbox", priority: 2, due: "2026-11-01", recur: ["mon"], pinnedDate: "2026-10-28", hiddenOn: "2026-10-28" },
      TODAY,
    );
    render(<InboxPage today={TODAY} />);
    await screen.findByRole("checkbox", { name: "Select Loose" });
    await userEvent.click(within(more("Loose")).getByRole("button", { name: "Idea" }));
    await vi.waitFor(async () => expect((await db.items.toArray())[0].kind).toBe("idea"));
    const got = (await db.items.toArray())[0];
    for (const k of ["due", "recur", "pinnedDate", "hiddenOn"] as const) expect(k in got).toBe(false);
    expect(got.areaId).toBe("inbox");
    await vi.waitFor(() =>
      expect(within(more("Loose")).getByRole("button", { name: "Idea" })).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.getByRole("checkbox", { name: "Select Loose" })).toBeInTheDocument();
    // and back to a to-do
    await userEvent.click(within(more("Loose")).getByRole("button", { name: "To-do" }));
    await vi.waitFor(async () => expect((await db.items.toArray())[0].kind).toBe("task"));
  });

  it("Make it a goal creates a practice goal in the chosen area and archives the item", async () => {
    await seed({ title: "Learn pottery" });
    render(<InboxPage today={TODAY} />);
    await screen.findByRole("checkbox", { name: "Select Learn pottery" });
    const d = more("Learn pottery");
    await userEvent.click(within(rowOf("Learn pottery")).getByText("More options", { selector: "summary" }));
    await userEvent.selectOptions(within(d).getByLabelText("Area for Learn pottery"), "art");
    await userEvent.click(within(d).getByRole("button", { name: "Make it a goal" }));
    await vi.waitFor(async () => expect(await db.goals.count()).toBe(1));
    expect((await db.goals.toArray())[0]).toMatchObject({ title: "Learn pottery", areaId: "art", kind: "practice" });
    const item = (await db.items.toArray())[0];
    expect(item).toMatchObject({ status: "archived", notes: "Became a goal: Learn pottery" });
    await vi.waitFor(() => expect(screen.queryByRole("checkbox", { name: "Select Learn pottery" })).toBeNull());
  });

  it("Make it a goal with no area chosen proposes admin", async () => {
    await seed({ title: "Vague" });
    render(<InboxPage today={TODAY} />);
    await screen.findByRole("checkbox", { name: "Select Vague" });
    await userEvent.click(within(more("Vague")).getByRole("button", { name: "Make it a goal" }));
    await vi.waitFor(async () => expect(await db.goals.count()).toBe(1));
    expect((await db.goals.toArray())[0].areaId).toBe("admin");
  });

  it("a failing Make it a goal shows the calm message and changes nothing", async () => {
    await seed({ title: "Vague" });
    render(<InboxPage today={TODAY} />);
    await screen.findByRole("checkbox", { name: "Select Vague" });
    const spy = vi.spyOn(db.items, "update").mockRejectedValue(new Error("boom"));
    await userEvent.click(within(more("Vague")).getByRole("button", { name: "Make it a goal" }));
    expect(await screen.findByText("That did not save. Try again.")).toBeInTheDocument();
    spy.mockRestore();
    expect(await db.goals.count()).toBe(0);
    expect((await db.items.toArray())[0].status).toBe("open");
  });
});

describe("filing details", () => {
  it("an idea is filed without a due date and has no Due field", async () => {
    await createItem({ kind: "idea", title: "Dreamy", areaId: "inbox", priority: 2, due: "2026-11-01" }, TODAY);
    render(<InboxPage today={TODAY} />);
    await screen.findByRole("checkbox", { name: "Select Dreamy" });
    expect(screen.queryByLabelText("Due for Dreamy")).toBeNull();
    const row = rowOf("Dreamy");
    await userEvent.click(within(row).getByText("More options", { selector: "summary" }));
    await userEvent.selectOptions(within(row).getByLabelText("Area for Dreamy"), "art");
    await userEvent.click(within(row).getByRole("button", { name: "File Dreamy" }));
    await vi.waitFor(async () => expect((await db.items.toArray())[0].areaId).toBe("art"));
    expect("due" in (await db.items.toArray())[0]).toBe(false);
  });

  it("File it is disabled while the write is running", async () => {
    await seed({ title: "Slow" });
    render(<InboxPage today={TODAY} />);
    await screen.findByRole("checkbox", { name: "Select Slow" });
    const row = rowOf("Slow");
    await userEvent.click(within(row).getByText("More options", { selector: "summary" }));
    await userEvent.selectOptions(within(row).getByLabelText("Area for Slow"), "art");
    let release: () => void = () => undefined;
    const spy = vi.spyOn(repo, "updateItem").mockImplementation(() => new Promise<void>((res) => (release = res)));
    const btn = within(row).getByRole("button", { name: "File Slow" });
    fireEvent.click(btn);
    await vi.waitFor(() => expect(btn).toBeDisabled());
    fireEvent.click(btn);
    expect(spy).toHaveBeenCalledTimes(1);
    release();
    spy.mockRestore();
  });

  it("a failed switch to Idea keeps the due date in the field", async () => {
    await createItem({ kind: "task", title: "Dated", areaId: "inbox", priority: 2, due: "2026-11-01" }, TODAY);
    render(<InboxPage today={TODAY} />);
    await screen.findByRole("checkbox", { name: "Select Dated" });
    const spy = vi.spyOn(db.items, "update").mockRejectedValue(new Error("boom"));
    await userEvent.click(within(rowOf("Dated")).getByRole("button", { name: "Idea" }));
    expect(await screen.findByText("That did not save. Try again.")).toBeInTheDocument();
    spy.mockRestore();
    expect(within(rowOf("Dated")).getByLabelText("Due for Dated")).toHaveValue("2026-11-01");
    expect((await db.items.toArray())[0].kind).toBe("task");
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
    await screen.findByRole("checkbox", { name: "Select Maybe done" });
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
    await screen.findByRole("checkbox", { name: "Select Tagged" });
    expect(document.querySelectorAll(".inbox-check")).toHaveLength(1);
    expect(screen.getByText("Check: <b>idea</b> or to-do?")).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });
});
