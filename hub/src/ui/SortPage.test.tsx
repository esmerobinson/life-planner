import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { db } from "../data/db";
import * as repo from "../data/repo";
import { createItem, listBin } from "../data/repo";
import type { Item } from "../domain/types";
import { SortPage } from "./SortPage";

const TODAY = "2026-10-28";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
  vi.restoreAllMocks();
});

/** Inbox items, oldest first (the queue's order). */
async function seed(...rows: (Partial<Item> & { title: string })[]) {
  const out: Item[] = [];
  let day = 1;
  for (const r of rows) {
    out.push(await createItem({ kind: "task", areaId: "inbox", priority: 2, ...r }, `2026-10-${String(day++).padStart(2, "0")}`));
  }
  return out;
}

function show() {
  return render(
    <MemoryRouter initialEntries={["/inbox/sort"]}>
      <Routes>
        <Route path="/inbox/sort" element={<SortPage today={TODAY} />} />
        <Route path="/inbox" element={<h1>Inbox page</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

const card = () => screen.getByRole("region", { name: "Item to sort" });
/** Waits until the card on screen (a new card replaces the old one) shows this title. */
const title = (t: string) => vi.waitFor(() => expect(within(card()).getByText(t)).toBeInTheDocument());
/** The line after an action (the celebration placeholder is a status too). */
const status = () => screen.getAllByRole("status").find((el) => el.classList.contains("undo-line"))!;

describe("Sort one by one: the card", () => {
  it("shows the first inbox item, its source line and step 1 with nothing chosen", async () => {
    await seed(
      { title: "Ask about the 1970s", tags: ["from-daily-notes"] },
      { title: "Second thing", source: { kind: "gtasks", key: "gtasks:x" } },
    );
    await createItem({ kind: "task", title: "Sorted already", areaId: "art", priority: 2, due: "2026-10-01" }, "2026-09-01");
    show();
    await title("Ask about the 1970s");
    expect(within(card()).getByText("from Obsidian · daily notes")).toBeInTheDocument();
    expect(within(card()).getByText("What is it?")).toBeInTheDocument();
    for (const t of ["To-do", "Idea", "Goal"]) expect(within(card()).getByRole("button", { name: t })).toBeInTheDocument();
    // Nothing preselected: the area grid is not there until a type is chosen.
    expect(within(card()).queryByText("Which area?")).toBeNull();
    expect(within(card()).queryByRole("button", { name: "Writing" })).toBeNull();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    // "Needs a look" items (sorted, overdue) are never in the queue.
    expect(screen.queryByText("Sorted already")).toBeNull();
  });

  it("step 2 replaces step 1 with a change link and the areas (no Inbox)", async () => {
    await seed({ title: "Learn to draw hands" });
    show();
    await title("Learn to draw hands");
    await userEvent.click(within(card()).getByRole("button", { name: "Idea" }));
    expect(within(card()).queryByText("What is it?")).toBeNull();
    expect(within(card()).getByRole("button", { name: "← Idea · change" })).toBeInTheDocument();
    expect(within(card()).getByText("Which area?")).toBeInTheDocument();
    const grid = within(card()).getByRole("group", { name: "Which area?" });
    expect(within(grid).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Admin", "Writing", "Art", "Content", "Mind", "Body", "Tech projects", "Production",
    ]);
    await userEvent.click(within(card()).getByRole("button", { name: "← Idea · change" }));
    expect(within(card()).getByText("What is it?")).toBeInTheDocument();
  });

  it("filing as To-do sets kind and area, shows the line, and the next item comes in", async () => {
    const [a] = await seed({ title: "Renew the passport", kind: "idea" }, { title: "Next one" });
    show();
    await title("Renew the passport");
    await userEvent.click(within(card()).getByRole("button", { name: "To-do" }));
    await userEvent.click(within(card()).getByRole("button", { name: "Admin" }));
    await title("Next one");
    expect(await db.items.get(a.id)).toMatchObject({ kind: "task", areaId: "admin" });
    expect(status()).toHaveTextContent("Filed as To-do in Admin · Undo");
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
  });

  it("filing as Idea sets the kind to idea and drops the due date", async () => {
    const [a] = await seed({ title: "A carousel about drafts", due: "2026-11-02" });
    show();
    await title("A carousel about drafts");
    await userEvent.click(within(card()).getByRole("button", { name: "Idea" }));
    await userEvent.click(within(card()).getByRole("button", { name: "Content" }));
    await screen.findByText("All sorted");
    const got = (await db.items.get(a.id))!;
    expect(got).toMatchObject({ kind: "idea", areaId: "content" });
    expect(got.due).toBeUndefined();
    expect(status()).toHaveTextContent("Filed as Idea in Content");
  });

  it("filing as Goal makes a practice goal in that area and archives the item (no Undo: a goal cannot be taken back)", async () => {
    const [a] = await seed({ title: "Try a sound bath class" });
    show();
    await title("Try a sound bath class");
    await userEvent.click(within(card()).getByRole("button", { name: "Goal" }));
    await userEvent.click(within(card()).getByRole("button", { name: "Mind" }));
    await screen.findByText("All sorted");
    const goals = await db.goals.toArray();
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ title: "Try a sound bath class", areaId: "mind", kind: "practice" });
    expect((await db.items.get(a.id))!.status).toBe("archived");
    expect(status()).toHaveTextContent("Filed as Goal in Mind");
    expect(within(status()).queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("Undo puts a filed item back in the inbox and on the card", async () => {
    const [a] = await seed({ title: "First" }, { title: "Second" });
    show();
    await title("First");
    await userEvent.click(within(card()).getByRole("button", { name: "To-do" }));
    await userEvent.click(within(card()).getByRole("button", { name: "Writing" }));
    await title("Second");
    await userEvent.click(within(status()).getByRole("button", { name: "Undo" }));
    await title("First");
    expect(await db.items.get(a.id)).toMatchObject({ areaId: "inbox", kind: "task" });
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
  });

  it("Skip changes nothing and the skipped item comes back at the end", async () => {
    const [a] = await seed({ title: "First" }, { title: "Second" });
    const before = (await db.items.get(a.id))!;
    show();
    await title("First");
    await userEvent.click(within(card()).getByRole("button", { name: "Skip →" }));
    await title("Second");
    expect(status()).toHaveTextContent("Skipped (it comes back at the end)");
    expect(await db.items.get(a.id)).toEqual(before);
    await userEvent.click(within(card()).getByRole("button", { name: "Skip →" }));
    await title("First");
  });

  it("Archive archives it, with Undo", async () => {
    const [a] = await seed({ title: "Old idea" });
    show();
    await title("Old idea");
    await userEvent.click(within(card()).getByRole("button", { name: "Archive" }));
    await screen.findByText("All sorted");
    expect((await db.items.get(a.id))!.status).toBe("archived");
    expect(status()).toHaveTextContent("Archived · Undo");
    await userEvent.click(within(status()).getByRole("button", { name: "Undo" }));
    await title("Old idea");
    expect((await db.items.get(a.id))!.status).toBe("open");
  });

  it("Delete moves it to the Bin, with Undo", async () => {
    const [a] = await seed({ title: "Not needed" });
    show();
    await title("Not needed");
    await userEvent.click(within(card()).getByRole("button", { name: "Delete" }));
    await screen.findByText("All sorted");
    expect((await listBin()).map((i) => i.id)).toEqual([a.id]);
    expect(status()).toHaveTextContent("Moved to the Bin · Undo");
  });

  it("works from step 2 too (Archive, Delete and Skip are on both steps)", async () => {
    await seed({ title: "Step two" });
    show();
    await title("Step two");
    await userEvent.click(within(card()).getByRole("button", { name: "To-do" }));
    for (const n of ["Archive", "Delete", "Skip →"]) expect(within(card()).getByRole("button", { name: n })).toBeInTheDocument();
  });

  it("a failed filing shows the calm message and keeps the item", async () => {
    await seed({ title: "Stubborn" });
    vi.spyOn(repo, "fileItem").mockRejectedValueOnce(new Error("boom"));
    show();
    await title("Stubborn");
    await userEvent.click(within(card()).getByRole("button", { name: "To-do" }));
    await userEvent.click(within(card()).getByRole("button", { name: "Art" }));
    expect(await screen.findByText("That did not save. Try again.")).toBeInTheDocument();
    await title("Stubborn");
  });

  it("when nothing is left: All sorted, the celebration placeholder and a link back to the Inbox", async () => {
    show();
    expect(await screen.findByText("All sorted")).toBeInTheDocument();
    expect(screen.getByTestId("celebration-placeholder")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Back to the Inbox" }));
    expect(await screen.findByRole("heading", { name: "Inbox page" })).toBeInTheDocument();
  });
});

describe("Sort one by one: keyboard", () => {
  it("1, 2 and 3 pick To-do, Idea and Goal", async () => {
    await seed({ title: "Keys" });
    show();
    await title("Keys");
    await userEvent.keyboard("2");
    expect(within(card()).getByRole("button", { name: "← Idea · change" })).toBeInTheDocument();
    await userEvent.keyboard("3");
    expect(within(card()).getByRole("button", { name: "← Goal · change" })).toBeInTheDocument();
    await userEvent.keyboard("1");
    expect(within(card()).getByRole("button", { name: "← To-do · change" })).toBeInTheDocument();
  });

  it("Escape goes back to the Inbox", async () => {
    await seed({ title: "Leaving" });
    show();
    await title("Leaving");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(await screen.findByRole("heading", { name: "Inbox page" })).toBeInTheDocument();
  });

  it("Escape in the notes box only leaves the box (and saves it)", async () => {
    const [a] = await seed({ title: "Staying" });
    show();
    await title("Staying");
    const box = within(card()).getByRole("textbox", { name: "Notes" });
    await userEvent.type(box, "kept{Escape}");
    expect(box).not.toHaveFocus();
    expect(screen.queryByRole("heading", { name: "Inbox page" })).toBeNull();
    await vi.waitFor(async () => expect((await db.items.get(a.id))!.notes).toBe("kept"));
  });
});

describe("Sort one by one: notes", () => {
  it("shows existing notes in an editable box, and a placeholder when there are none", async () => {
    await seed({ title: "With notes", notes: "Practise 10 min a day" }, { title: "Without" });
    show();
    await title("With notes");
    expect(within(card()).getByRole("textbox", { name: "Notes" })).toHaveValue("Practise 10 min a day");
    await userEvent.click(within(card()).getByRole("button", { name: "Skip →" }));
    await title("Without");
    expect(within(card()).getByRole("textbox", { name: "Notes" })).toHaveAttribute("placeholder", "Add a note…");
  });

  it("typing 1, 2 or 3 in the notes never picks a type; leaving the box saves", async () => {
    const [a] = await seed({ title: "Typed" });
    show();
    await title("Typed");
    const box = within(card()).getByRole("textbox", { name: "Notes" });
    await userEvent.type(box, "call 123");
    expect(within(card()).getByText("What is it?")).toBeInTheDocument();
    await userEvent.tab();
    await vi.waitFor(async () => expect((await db.items.get(a.id))!.notes).toBe("call 123"));
  });

  it("what is typed is saved before filing, even without leaving the box", async () => {
    const [a] = await seed({ title: "Note then file" });
    show();
    await title("Note then file");
    const box = within(card()).getByRole("textbox", { name: "Notes" });
    fireEvent.change(box, { target: { value: "remember the receipt" } });
    fireEvent.keyDown(document.body, { key: "1" });
    await userEvent.click(within(card()).getByRole("button", { name: "Body" }));
    await screen.findByText("All sorted");
    expect(await db.items.get(a.id)).toMatchObject({ notes: "remember the receipt", areaId: "body", kind: "task" });
  });

  it("what is typed is saved before Skip, Archive and Delete too", async () => {
    const [a, b, c] = await seed({ title: "Skip me" }, { title: "Archive me" }, { title: "Delete me" });
    show();
    for (const [t, action] of [["Skip me", "Skip →"], ["Archive me", "Archive"], ["Delete me", "Delete"]] as const) {
      await title(t);
      fireEvent.change(within(card()).getByRole("textbox", { name: "Notes" }), { target: { value: `note for ${t}` } });
      await userEvent.click(within(card()).getByRole("button", { name: action }));
    }
    await vi.waitFor(async () => {
      expect((await db.items.get(a.id))!.notes).toBe("note for Skip me");
      expect((await db.items.get(b.id))!.notes).toBe("note for Archive me");
      expect((await db.items.get(c.id))!.notes).toBe("note for Delete me");
    });
  });
});
