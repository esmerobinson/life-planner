import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { createGoal, createItem } from "../data/repo";
import { clearPageEdits, currentUpdateHold, installEditTracker, pageEdited } from "../native/updateHolds";
import { renderApp } from "../test/renderApp";

// What the phone's automatic update (native/pwaUpdate.ts) waits for, in the real app (fix round 1:
// nothing edited on the page, no sheet, no Edit mode, no pairing; no list of editors).

const TODAY = "2026-11-19";
const sheet = () => screen.getByRole("dialog", { name: "Add" });
const panel = async () => within(await screen.findByRole("complementary", { name: /\S/ }));

let stop: (() => void) | null = null;
beforeEach(async () => {
  await Promise.all([db.items.clear(), db.goals.clear()]);
  localStorage.clear();
  stop = installEditTracker(document);
  clearPageEdits();
});
afterEach(() => {
  stop?.();
  vi.useRealTimers();
});

describe("automatic updates wait for", () => {
  it("nothing on a page nobody has edited", async () => {
    renderApp("/", TODAY);
    await screen.findByRole("button", { name: "Add" });
    expect(currentUpdateHold()).toBeNull();
  });

  it("text typed in the Inbox box, after it loses the focus; a new page forgets it", async () => {
    renderApp("/inbox", TODAY);
    const box = await screen.findByRole("textbox", { name: "Add to inbox" });
    await userEvent.type(box, "Pretend half a thought");
    box.blur();
    expect(currentUpdateHold()).toBe("edited");
    await userEvent.click(screen.getAllByRole("link", { name: /^Home|^Today/ })[0]!);
    await waitFor(() => expect(currentUpdateHold()).toBeNull());
  });

  it("a to-do's Edit mode, even before anything is changed", async () => {
    const t = await createItem({ kind: "task", title: "Pretend send chapter", areaId: "writing", priority: 2 }, TODAY);
    renderApp(`/area/writing?open=${t.id}`, TODAY);
    const p = await panel();
    expect(currentUpdateHold()).toBeNull();
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    expect(currentUpdateHold()).not.toBeNull();
  });

  it("a select changed in a to-do's Edit mode marks the page edited (and Edit mode holds by itself)", async () => {
    const t = await createItem({ kind: "task", title: "Pretend send chapter", areaId: "writing", priority: 2 }, TODAY);
    renderApp(`/area/writing?open=${t.id}`, TODAY);
    const p = await panel();
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    const select = p.getAllByRole("combobox")[0]!;
    const other = [...(select as HTMLSelectElement).options].find((o) => !o.selected)!;
    await userEvent.selectOptions(select, other.value);
    expect(pageEdited()).toBe(true);
    clearPageEdits(); // (only to see the Edit-mode hold by itself)
    expect(currentUpdateHold()).toBe("editing");
  });

  it("a goal's Edit mode (month goals saved as it goes, undone on Cancel)", async () => {
    const g = await createGoal({ title: "Pretend calm", areaId: "mind", kind: "practice" }, TODAY);
    renderApp(`/goals?open=${g.id}`, TODAY);
    const p = await panel();
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    expect(currentUpdateHold()).toBe("editing");
  });

  it("the Sync page's address field, typed in", async () => {
    renderApp("/sync", TODAY);
    const field = await screen.findByLabelText("Sync address");
    await userEvent.type(field, "x");
    field.blur();
    expect(currentUpdateHold()).toBe("edited");
  });

  it("the quick box while its sheet is open; not once it is closed (its text is kept on the device)", async () => {
    renderApp("/", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Add" }));
    expect(currentUpdateHold()).toBe("sheet"); // open, even empty
    await userEvent.type(within(sheet()).getByRole("textbox", { name: "What's on your mind?" }), "Pretend half a thought");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add" })).toBeNull());
    expect(currentUpdateHold()).toBeNull();
  });

  it("the full Add form's kept draft, even closed (it lives only in the page)", async () => {
    renderApp("/", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Add" }));
    await userEvent.click(within(sheet()).getByRole("button", { name: "More options" }));
    await userEvent.type(within(sheet()).getByRole("textbox", { name: "Title" }), "Pretend big plan");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add" })).toBeNull());
    expect(currentUpdateHold()).toBe("draft");
  });

  it("not a ticked to-do (saved at once)", async () => {
    await createItem({ kind: "task", title: "Pretend water plants", areaId: "writing", priority: 2 }, TODAY);
    renderApp("/area/writing", TODAY);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Mark done: Pretend water plants" }));
    expect(currentUpdateHold()).toBeNull();
  });

  it("not the Journal by itself (only what is typed there)", async () => {
    renderApp("/journal/morning", TODAY);
    await screen.findByRole("navigation", { name: "Journal parts" });
    expect(currentUpdateHold()).toBeNull();
  });
});
