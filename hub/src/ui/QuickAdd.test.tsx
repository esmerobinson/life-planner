import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { createGoal } from "../data/repo";
import { QuickAdd } from "./QuickAdd";
import { ShellContext } from "./shellContext";

const TODAY = "2026-10-27";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

describe("QuickAdd", () => {
  it("title is required; submit is blocked and a plain message shows", async () => {
    const onAdded = vi.fn();
    render(<QuickAdd today={TODAY} onAdded={onAdded} />);
    await userEvent.type(screen.getByLabelText("Title"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(screen.getByText("A title is needed.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(await db.items.count()).toBe(0);
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("task with area, goal, priority and due is saved with those fields", async () => {
    const g = await createGoal({ title: "Finish novel", areaId: "writing", kind: "practice" }, TODAY);
    const onAdded = vi.fn();
    render(<QuickAdd today={TODAY} onAdded={onAdded} />);
    await userEvent.type(screen.getByLabelText("Title"), "Draft chapter");
    await userEvent.selectOptions(screen.getByLabelText("Area"), "writing");
    await userEvent.selectOptions(screen.getByLabelText("Goal"), g.id);
    await userEvent.selectOptions(screen.getByLabelText("Priority"), "3");
    await userEvent.type(screen.getByLabelText("Due"), "2026-11-02");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    await vi.waitFor(async () => expect(await db.items.count()).toBe(1));
    const [it] = await db.items.toArray();
    expect(it).toMatchObject({
      kind: "task", title: "Draft chapter", areaId: "writing", goalId: g.id,
      priority: 3, due: "2026-11-02", links: [], status: "open",
    });
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Title")).toHaveValue("");
  });

  it("a fast double submit creates exactly one item and disables the button while saving", async () => {
    const onAdded = vi.fn();
    render(<QuickAdd today={TODAY} onAdded={onAdded} />);
    await userEvent.type(screen.getByLabelText("Title"), "Once only");
    const btn = screen.getByRole("button", { name: "Add item" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(btn).not.toBeDisabled());
    expect(await db.items.count()).toBe(1);
  });

  it("defaults to a task in the inbox with priority 2", async () => {
    render(<QuickAdd today={TODAY} onAdded={() => {}} />);
    await userEvent.type(screen.getByLabelText("Title"), "Plain");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    await vi.waitFor(async () => expect(await db.items.count()).toBe(1));
    const [it] = await db.items.toArray();
    expect(it).toMatchObject({ kind: "task", areaId: "inbox", priority: 2 });
    expect(it.due).toBeUndefined();
    expect(it.recur).toBeUndefined();
  });

  it("idea hides due and recurring and saves kind idea", async () => {
    render(<QuickAdd today={TODAY} onAdded={() => {}} />);
    expect(screen.getByLabelText("Due")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Type"), "idea");
    expect(screen.queryByLabelText("Due")).toBeNull();
    expect(screen.queryByLabelText("mon")).toBeNull();
    await userEvent.type(screen.getByLabelText("Title"), "Comic about ferns");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    await vi.waitFor(async () => expect(await db.items.count()).toBe(1));
    const [it] = await db.items.toArray();
    expect(it.kind).toBe("idea");
    expect(it.due).toBeUndefined();
    expect(it.recur).toBeUndefined();
  });

  it("recurring weekdays are saved as recur: ['mon','wed']", async () => {
    render(<QuickAdd today={TODAY} onAdded={() => {}} />);
    await userEvent.type(screen.getByLabelText("Title"), "Stretch");
    await userEvent.click(screen.getByLabelText("wed"));
    await userEvent.click(screen.getByLabelText("mon"));
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    await vi.waitFor(async () => expect(await db.items.count()).toBe(1));
    const [it] = await db.items.toArray();
    expect(it.recur).toEqual(["mon", "wed"]);
  });

  it("goal select only offers goals in the chosen area", async () => {
    await createGoal({ title: "Novel", areaId: "writing", kind: "practice" }, TODAY);
    await createGoal({ title: "Portfolio", areaId: "art", kind: "practice" }, TODAY);
    render(<QuickAdd today={TODAY} onAdded={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText("Area"), "writing");
    expect(await screen.findByRole("option", { name: "Novel" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Portfolio" })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Area"), "art");
    expect(await screen.findByRole("option", { name: "Portfolio" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Novel" })).toBeNull();
  });

  it("re-reads goals when the shell version changes", async () => {
    const shell = (version: number) => (
      <ShellContext.Provider value={{ refresh: () => {}, version, today: TODAY }}>
        <QuickAdd today={TODAY} onAdded={() => {}} />
      </ShellContext.Provider>
    );
    const { rerender } = render(shell(0));
    await userEvent.selectOptions(screen.getByLabelText("Area"), "writing");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("option", { name: "New novel" })).toBeNull();
    await createGoal({ title: "New novel", areaId: "writing", kind: "practice" }, TODAY);
    rerender(shell(1));
    expect(await screen.findByRole("option", { name: "New novel" })).toBeInTheDocument();
  });

  it("notes typed in the Add form are saved as the item's page; blank notes are left off", async () => {
    render(<QuickAdd today={TODAY} onAdded={() => {}} />);
    await userEvent.type(screen.getByLabelText("Title"), "With a note");
    await userEvent.type(screen.getByLabelText("Notes"), "First pretend line{Enter}second line");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    await vi.waitFor(async () => expect(await db.items.count()).toBe(1));
    expect((await db.items.toArray())[0].notes).toBe("First pretend line\nsecond line");
    expect(screen.getByLabelText("Notes")).toHaveValue("");
    await userEvent.type(screen.getByLabelText("Title"), "No note");
    await userEvent.type(screen.getByLabelText("Notes"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    await vi.waitFor(async () => expect(await db.items.count()).toBe(2));
    const bare = (await db.items.toArray()).find((i) => i.title === "No note")!;
    expect(bare).not.toHaveProperty("notes");
  });

  it("an idea saves its notes too", async () => {
    render(<QuickAdd today={TODAY} onAdded={() => {}} defaults={{ type: "idea", areaId: "art" }} />);
    await userEvent.type(screen.getByLabelText("Title"), "Pretend comic");
    await userEvent.type(screen.getByLabelText("Notes"), "Panels of ferns");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    await vi.waitFor(async () => expect(await db.items.count()).toBe(1));
    expect((await db.items.toArray())[0]).toMatchObject({ kind: "idea", areaId: "art", notes: "Panels of ferns" });
  });

  it("type Goal makes a goal (with its notes) through the repo, never in the inbox", async () => {
    const onAdded = vi.fn();
    render(<QuickAdd today={TODAY} onAdded={onAdded} />);
    await userEvent.selectOptions(screen.getByLabelText("Type"), "goal");
    const areas = Array.from(screen.getByLabelText("Area").querySelectorAll("option")).map((o) => o.textContent);
    expect(areas).not.toContain("Inbox");
    expect(screen.queryByLabelText("Due")).toBeNull();
    expect(screen.queryByLabelText("Priority")).toBeNull();
    await userEvent.type(screen.getByLabelText("Title"), "Pretend marathon");
    await userEvent.selectOptions(screen.getByLabelText("Area"), "body");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(screen.getByText("A finite goal needs a deadline.")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Kind of goal"), "practice");
    await userEvent.type(screen.getByLabelText("Monthly target"), "8");
    await userEvent.type(screen.getByLabelText("Notes"), "Long runs on Sundays");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    await vi.waitFor(async () => expect(await db.goals.count()).toBe(1));
    const [g] = await db.goals.toArray();
    expect(g).toMatchObject({
      title: "Pretend marathon", areaId: "body", kind: "practice", monthlyTarget: 8, notes: "Long runs on Sundays",
    });
    expect(await db.items.count()).toBe(0);
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
  });

  it("a goal's notes are capped at the goal page size", async () => {
    render(<QuickAdd today={TODAY} onAdded={() => {}} defaults={{ type: "goal", areaId: "art" }} />);
    expect(screen.getByLabelText("Notes")).toHaveAttribute("maxLength", "4000");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "task");
    expect(screen.getByLabelText("Notes")).toHaveAttribute("maxLength", "20000");
  });

  it("opens pre-set from its defaults and goes back to them after a save", async () => {
    render(<QuickAdd today={TODAY} onAdded={() => {}} defaults={{ type: "idea", areaId: "content" }} />);
    expect(screen.getByLabelText("Type")).toHaveValue("idea");
    expect(screen.getByLabelText("Area")).toHaveValue("content");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "task");
    await userEvent.selectOptions(screen.getByLabelText("Area"), "art");
    await userEvent.type(screen.getByLabelText("Title"), "Changed my mind");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    await vi.waitFor(async () => expect(await db.items.count()).toBe(1));
    expect((await db.items.toArray())[0]).toMatchObject({ kind: "task", areaId: "art" });
    await vi.waitFor(() => expect(screen.getByLabelText("Type")).toHaveValue("idea"));
    expect(screen.getByLabelText("Area")).toHaveValue("content");
  });

  it("the Area select offers the three new areas and the inbox", () => {
    render(<QuickAdd today={TODAY} onAdded={vi.fn()} />);
    const names = Array.from(screen.getByLabelText("Area").querySelectorAll("option")).map((o) => o.textContent);
    expect(names).toEqual([
      "Inbox", "Writing", "Art", "Content", "Mind", "Body", "Tech projects", "Production", "Admin",
    ]);
  });
});
