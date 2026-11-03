import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { createItem } from "../data/repo";
import type { Session } from "../domain/types";
import { renderApp } from "../test/renderApp";

// A project's side panel (2C): the Sessions list. Pretend data only.
const TODAY = "2026-11-02";
const LONG = "Warm dusk light over the whole street, with strings of papel picado between the stalls and a few lamps. ".repeat(3);

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});
afterEach(() => vi.useRealTimers());

async function openProject(sessions: Session[]) {
  const p = await createItem(
    { kind: "task", title: "Pretend street scene", areaId: "art", priority: 2, due: "2026-11-09", notes: "Pretend notes", sessions },
    "2026-10-29",
  );
  renderApp(`/area/art?open=${p.id}`, TODAY);
  const panel = await screen.findByRole("complementary", { name: "Pretend street scene" });
  return { p, panel };
}
const FOUR: Session[] = [
  { id: "a", title: "Block out the street", doneOn: "2026-10-30" },
  { id: "b", doneOn: TODAY },
  { id: "c", title: "Lighting", details: "Warm dusk light", plannedFor: "2026-11-05" },
  { id: "d" },
];
const sessionRows = (panel: HTMLElement) => within(within(panel).getByRole("list", { name: "Sessions" })).getAllByRole("listitem");

describe("Edit → Type in the panel", () => {
  it("a done to-do made a Project is open again, with 4 sessions (never a done project with open sessions)", async () => {
    const t = await createItem({ kind: "task", title: "Pretend done mural", areaId: "art", priority: 2 }, "2026-10-29");
    await db.items.update(t.id, { status: "done", completedAt: "2026-11-01" });
    renderApp(`/area/art?open=${t.id}`, TODAY);
    const panel = await screen.findByRole("complementary", { name: "Pretend done mural" });
    await userEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(within(panel).getByLabelText("Type"), "project");
    await userEvent.click(within(panel).getByRole("button", { name: "Done" }));
    await vi.waitFor(async () => expect((await db.items.get(t.id))!.sessions).toHaveLength(4));
    const got = (await db.items.get(t.id))!;
    expect(got.status).toBe("open");
    expect(got.completedAt).toBeUndefined();
  });
});

describe("Edit → Type away from Project (I-2)", () => {
  it("drops the sessions with an Undo that brings them back, titles and details included", async () => {
    const { p, panel } = await openProject(FOUR);
    await userEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(within(panel).getByLabelText("Type"), "idea");
    await userEvent.click(within(panel).getByRole("button", { name: "Done" }));
    await vi.waitFor(async () => expect((await db.items.get(p.id))!.kind).toBe("idea"));
    expect((await db.items.get(p.id))!.sessions).toBeUndefined();
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await vi.waitFor(async () => expect((await db.items.get(p.id))!.sessions).toEqual(FOUR));
    expect(await db.items.get(p.id)).toMatchObject({ kind: "task", due: "2026-11-09" });
  });
});

describe("a project's side panel", () => {
  it("says Project, shows the deadline, the session count and the summary box", async () => {
    const { panel } = await openProject(FOUR);
    expect(within(panel).getByText("Project", { selector: ".peek-kicker" })).toBeInTheDocument();
    expect(within(panel).getByText("Project", { selector: ".chip" })).toBeInTheDocument();
    expect(within(panel).getByText("Deadline")).toBeInTheDocument();
    expect(within(panel).getByText("Mon 9 Nov")).toBeInTheDocument();
    expect(within(panel).getByText("2 of 4 sessions")).toBeInTheDocument();
    expect(within(panel).getByText("7 days left")).toBeInTheDocument();
    expect(within(panel).getByText("Pretend notes")).toBeInTheDocument();
  });

  it("lists each session: tick, title (placeholder Session N), details, done date or planned day", async () => {
    const { panel } = await openProject(FOUR);
    const rows = sessionRows(panel);
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByRole("checkbox", { name: "Session 1: Block out the street" })).toBeChecked();
    expect(within(rows[0]).getByRole("textbox", { name: "Title of session 1" })).toHaveValue("Block out the street");
    expect(within(rows[0]).getByText("Done Fri 30 Oct")).toBeInTheDocument();
    expect(rows[0]).toHaveClass("crossed");
    expect(within(rows[1]).getByText("Done today")).toBeInTheDocument();
    const t2 = within(rows[1]).getByRole("textbox", { name: "Title of session 2" });
    expect(t2).toHaveValue("");
    expect(t2).toHaveAttribute("placeholder", "Session 2");
    expect(within(rows[2]).getByRole("textbox", { name: "Details of session 3" })).toHaveValue("Warm dusk light");
    expect(within(rows[2]).getByText("On Thu 5 Nov")).toBeInTheDocument();
    expect(within(rows[3]).getByRole("checkbox", { name: "Session 4" })).not.toBeChecked();
    // Done sessions have no menu (nothing to plan or remove) and offer no "+ Add details".
    expect(within(rows[0]).queryByRole("button", { name: /Plan/ })).toBeNull();
    expect(within(rows[0]).queryByRole("button", { name: /Add details/ })).toBeNull();
    expect(within(rows[3]).getByRole("button", { name: "Add details to session 4" })).toBeInTheDocument();
  });

  it("a title is typed straight in and saved on leaving the field (trimmed; blank = unnamed)", async () => {
    const { p, panel } = await openProject(FOUR);
    const t = within(sessionRows(panel)[3]).getByRole("textbox", { name: "Title of session 4" });
    await userEvent.type(t, "  Render and tidy up ");
    fireEvent.blur(t);
    await vi.waitFor(async () => expect((await db.items.get(p.id))!.sessions![3].title).toBe("Render and tidy up"));
    const t1 = within(sessionRows(panel)[0]).getByRole("textbox", { name: "Title of session 1" });
    await userEvent.clear(t1);
    fireEvent.blur(t1);
    await vi.waitFor(async () => expect((await db.items.get(p.id))!.sessions![0].title).toBeUndefined());
  });

  it("details are optional: + Add details opens the field, saved on leaving it", async () => {
    const { p, panel } = await openProject(FOUR);
    const row = sessionRows(panel)[3];
    await userEvent.click(within(row).getByRole("button", { name: "Add details to session 4" }));
    const d = within(row).getByRole("textbox", { name: "Details of session 4" });
    expect(d).toHaveFocus();
    await userEvent.type(d, "Final render at 1080p");
    fireEvent.blur(d);
    await vi.waitFor(async () => expect((await db.items.get(p.id))!.sessions![3].details).toBe("Final render at 1080p"));
  });

  it("long details are cut short with See more", async () => {
    const { panel } = await openProject([{ id: "a", details: LONG }]);
    const row = sessionRows(panel)[0];
    expect(within(row).queryByRole("textbox", { name: "Details of session 1" })).toBeNull();
    expect(within(row).getByText(LONG.trim(), { exact: false, selector: ".session-details-short" })).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "See more: session 1" }));
    expect(within(row).getByRole("textbox", { name: "Details of session 1" })).toHaveValue(LONG);
  });

  it("the tick ticks that session; + Add a session adds an unnamed one", async () => {
    const { p, panel } = await openProject(FOUR);
    await userEvent.click(within(sessionRows(panel)[3]).getByRole("checkbox", { name: "Session 4" }));
    await vi.waitFor(async () => expect((await db.items.get(p.id))!.sessions![3].doneOn).toBe(TODAY));
    await userEvent.click(within(panel).getByRole("button", { name: "+ Add a session" }));
    await vi.waitFor(() => expect(sessionRows(panel)).toHaveLength(5));
    expect(within(sessionRows(panel)[4]).getByRole("textbox", { name: "Title of session 5" })).toHaveAttribute("placeholder", "Session 5");
  });

  it("the calendar plans a session for a day; its menu removes a session that is not done", async () => {
    const { p, panel } = await openProject(FOUR);
    const row = sessionRows(panel)[3];
    await userEvent.click(within(row).getByRole("button", { name: "Plan session 4" }));
    await userEvent.click(within(row).getByRole("button", { name: "Today" }));
    await vi.waitFor(async () => expect((await db.items.get(p.id))!.sessions![3].plannedFor).toBe(TODAY));
    await vi.waitFor(() => expect(within(sessionRows(panel)[3]).getByText("On Mon 2 Nov")).toBeInTheDocument());
    await userEvent.click(within(sessionRows(panel)[2]).getByRole("button", { name: "Plan session 3" }));
    await userEvent.click(within(sessionRows(panel)[2]).getByRole("button", { name: "Remove session" }));
    await vi.waitFor(async () => expect((await db.items.get(p.id))!.sessions!.map((s) => s.id)).toEqual(["a", "b", "d"]));
  });
});
