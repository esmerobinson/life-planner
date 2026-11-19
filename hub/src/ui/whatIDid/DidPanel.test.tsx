import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import type { Item } from "../../domain/types";
import { renderApp } from "../../test/renderApp";

// The side panel's "What I did" (Esme, 19 Nov 2026): add or edit the note later. Made-up to-dos.

const TODAY = "2026-11-18";
const todo = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: `Pretend ${id}`, links: [], areaId: "writing", priority: 2, status: "done",
  completedAt: "2026-11-17", createdAt: "2026-11-01", touchedAt: "2026-11-01", ...extra,
});

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.goals.clear(), db.syncMeta.clear()]);
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

const section = () => screen.findByRole("region", { name: "What I did" });

it("a done to-do with a note: shown to edit; edits are saved", async () => {
  await db.items.put(todo("chapter", { did: [{ id: "e1", on: "2026-11-17", note: "Pretend first draft", files: [{ name: "ch1.docx", folder: "~/Desktop/Writing" }] }] }));
  renderApp("/area/writing?open=chapter", TODAY);
  const s = await section();
  const box = within(s).getByRole("textbox", { name: "What I did" });
  expect(box).toHaveValue("Pretend first draft");
  expect(within(s).getByText("ch1.docx")).toBeInTheDocument();
  expect(within(s).getByText("Attach files on your Mac")).toBeInTheDocument();
  await userEvent.type(box, "Pretend second draft", { initialSelectionStart: 0, initialSelectionEnd: (box as HTMLTextAreaElement).value.length });
  box.blur();
  await waitFor(async () => expect((await db.items.get("chapter"))!.did![0]!.note).toBe("Pretend second draft"));
});

it("one without a note can have one added later, dated the day it was done", async () => {
  await db.items.put(todo("letter", { areaId: "admin" }));
  renderApp("/area/admin?open=letter", TODAY);
  const box = within(await section()).getByRole("textbox", { name: "What I did" });
  await userEvent.type(box, "Pretend posted it");
  box.blur();
  await waitFor(async () => expect((await db.items.get("letter"))!.did).toEqual([expect.objectContaining({ on: "2026-11-17", note: "Pretend posted it" })]));
});

it("a project: one box per session's note, named by its session", async () => {
  await db.items.put(todo("zine", {
    areaId: "art", status: "open", completedAt: undefined,
    sessions: [{ id: "s1", doneOn: "2026-11-16" }, { id: "s2", title: "Pretend inking", doneOn: "2026-11-17" }],
    did: [{ id: "e1", on: "2026-11-16", session: "s1", note: "Pretend sketched" }, { id: "e2", on: "2026-11-17", session: "s2", note: "Pretend inked" }],
  }));
  renderApp("/area/art?open=zine", TODAY);
  const s = await section();
  expect(within(s).getByText(/Session 1/)).toBeInTheDocument();
  expect(within(s).getByText(/Session 2: Pretend inking/)).toBeInTheDocument();
  expect(within(s).getAllByRole("textbox")).toHaveLength(2);
});

it("an open to-do without a note: no box yet (review M8: 'did', not 'doing')", async () => {
  await db.items.put(todo("later", { status: "open", completedAt: undefined }));
  renderApp("/area/writing?open=later", TODAY);
  await screen.findByRole("textbox", { name: "Title" });
  expect(screen.queryByRole("region", { name: "What I did" })).toBeNull();
});

it("not on habits or ideas", async () => {
  await db.items.put(todo("yoga", { status: "open", completedAt: undefined, recur: ["mon"] }));
  await db.items.put(todo("idea", { kind: "idea", status: "open", completedAt: undefined }));
  renderApp("/area/writing?open=yoga", TODAY);
  await screen.findByRole("textbox", { name: "Title" });
  expect(screen.queryByRole("region", { name: "What I did" })).toBeNull();
});
