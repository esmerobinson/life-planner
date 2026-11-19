import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../../data/db";
import type { Item } from "../../domain/types";
import { renderApp } from "../../test/renderApp";
import { FILES_HANDLER } from "../../native/files";

// "What did you do?" after a to-do tick (Esme, 19 Nov 2026). Made-up to-dos only.

const TODAY = "2026-11-18";
const todo = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: `Pretend ${id}`, links: [], areaId: "writing", priority: 2, status: "open",
  createdAt: "2026-11-01", touchedAt: "2026-11-01", ...extra,
});

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.goals.clear(), db.syncMeta.clear()]);
  localStorage.clear();
  delete (window as unknown as { webkit?: unknown }).webkit;
});
afterEach(() => vi.useRealTimers());

async function tickOn(page: string, title: string) {
  renderApp(page, TODAY);
  await userEvent.click(await screen.findByRole("checkbox", { name: `Mark done: ${title}` }));
  return screen.findByRole("dialog", { name: "What did you do?" });
}

it("a tick: done at once, then the sheet with the box focused; Save keeps what was typed", async () => {
  await db.items.put(todo("chapter"));
  const sheet = await tickOn("/area/writing", "Pretend chapter");
  expect((await db.items.get("chapter"))!.status).toBe("done");
  const box = within(sheet).getByRole("textbox", { name: "What did you do?" });
  await waitFor(() => expect(box).toHaveFocus());
  expect(within(sheet).getByText("Pretend chapter")).toBeInTheDocument();
  // Not in the Mac app: no Attach, the line says where.
  expect(within(sheet).queryByRole("button", { name: "Attach files" })).toBeNull();
  expect(within(sheet).getByText("Attach files on your Mac")).toBeInTheDocument();
  await userEvent.type(box, "Pretend wrote 400 words");
  await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
  expect(screen.queryByRole("dialog", { name: "What did you do?" })).toBeNull();
  await waitFor(async () => expect((await db.items.get("chapter"))!.did?.[0]?.note).toBe("Pretend wrote 400 words"));
  expect((await db.items.get("chapter"))!.did![0]!.on).toBe(TODAY);
});

it("Skip closes it, the to-do stays done, nothing is written", async () => {
  await db.items.put(todo("bills", { areaId: "admin" }));
  const sheet = await tickOn("/area/admin", "Pretend bills");
  await userEvent.click(within(sheet).getByRole("button", { name: "Skip" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  const row = (await db.items.get("bills"))!;
  expect(row.status).toBe("done");
  expect(row.did).toBeUndefined();
});

it("Escape closes it and keeps the typing; the side panel shows it to edit later", async () => {
  await db.items.put(todo("essay"));
  const sheet = await tickOn("/area/writing", "Pretend essay");
  await userEvent.type(within(sheet).getByRole("textbox"), "Pretend half a thought");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(async () => expect((await db.items.get("essay"))!.did?.[0]?.note).toBe("Pretend half a thought"));
  expect((await db.items.get("essay"))!.status).toBe("done");
});

it("never costs a click (review I1): ticking the next to-do while it is open ticks it and asks about that one", async () => {
  await db.items.bulkPut([todo("walk", { areaId: "body" }), todo("swim", { areaId: "body" }), todo("stretch", { areaId: "body" })]);
  renderApp("/area/body", TODAY);
  for (const t of ["walk", "swim", "stretch"]) {
    await userEvent.click(await screen.findByRole("checkbox", { name: `Mark done: Pretend ${t}` }));
    const sheet = await screen.findByRole("dialog", { name: "What did you do?" });
    await waitFor(() => expect(within(sheet).getByText(`Pretend ${t}`)).toBeInTheDocument());
  }
  for (const t of ["walk", "swim", "stretch"]) expect((await db.items.get(t))!.status).toBe("done");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});

it("a click anywhere else saves what was typed and closes it, and the click still lands", async () => {
  await db.items.put(todo("draw", { areaId: "art" }));
  const sheet = await tickOn("/area/art", "Pretend draw");
  await userEvent.type(within(sheet).getByRole("textbox"), "Pretend sketched a fox");
  await userEvent.click(screen.getByRole("button", { name: "Ideas" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Ideas" })).toHaveAttribute("aria-pressed", "true");
  await waitFor(async () => expect((await db.items.get("draw"))!.did?.[0]?.note).toBe("Pretend sketched a fox"));
});

it("typed and deleted again: no draft is left behind (review C1, R1)", async () => {
  await db.items.put(todo("nap", { areaId: "body" }));
  const sheet = await tickOn("/area/body", "Pretend nap");
  await userEvent.type(within(sheet).getByRole("textbox"), "x{Backspace}");
  await userEvent.click(within(sheet).getByRole("button", { name: "Skip" }));
  expect(Object.keys(localStorage).filter((k) => k.startsWith("esmeworld-what-i-did"))).toEqual([]);
  expect((await db.items.get("nap"))!.did).toBeUndefined();
});

it("first use: it says plainly these notes aren't locked like the journal (review I2)", async () => {
  await db.items.bulkPut([todo("one", { areaId: "admin" }), todo("two", { areaId: "admin" })]);
  const sheet = await tickOn("/area/admin", "Pretend one");
  expect(within(sheet).getByText("These notes aren't locked like your journal.")).toBeInTheDocument();
  await userEvent.click(within(sheet).getByRole("button", { name: "Skip" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Mark done: Pretend two" }));
  const again = await screen.findByRole("dialog", { name: "What did you do?" });
  expect(within(again).queryByText("These notes aren't locked like your journal.")).toBeNull();
});

it("habits never ask", async () => {
  await db.items.put(todo("yoga", { areaId: "body", recur: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] }));
  renderApp("/area/body", TODAY);
  await userEvent.click(await screen.findByRole("checkbox", { name: "Mark done: Pretend yoga" }));
  await waitFor(async () => expect((await db.items.get("yoga"))!.doneDates).toEqual([TODAY]));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("a project's tick asks for that session's note", async () => {
  await db.items.put(todo("zine", { areaId: "art", sessions: [{ id: "s1" }, { id: "s2" }] }));
  renderApp("/area/art", TODAY);
  await userEvent.click(await screen.findByRole("checkbox", { name: "Log a session: Pretend zine" }));
  const sheet = await screen.findByRole("dialog", { name: "What did you do?" });
  await userEvent.type(within(sheet).getByRole("textbox"), "Pretend sketched");
  await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
  await waitFor(async () => expect((await db.items.get("zine"))!.did).toEqual([expect.objectContaining({ session: "s1", note: "Pretend sketched" })]));
});

it("a project ticked with every session already done: the note goes on the last session ticked (review M9)", async () => {
  await db.items.put(todo("quilt", { areaId: "art", sessions: [{ id: "s1", doneOn: "2026-11-10" }, { id: "s2", doneOn: "2026-11-12" }] }));
  renderApp("/area/art", TODAY);
  await userEvent.click(await screen.findByRole("checkbox", { name: "Log a session: Pretend quilt" }));
  const sheet = await screen.findByRole("dialog", { name: "What did you do?" });
  await userEvent.type(within(sheet).getByRole("textbox"), "Pretend finished the binding");
  await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
  await waitFor(async () => expect((await db.items.get("quilt"))!.did).toEqual([{ id: "s2", on: TODAY, session: "s2", note: "Pretend finished the binding" }]));
});

it("re-ticked on a later day: the note moves to that day once she writes (review M7)", async () => {
  await db.items.put(todo("redo", { did: [{ id: "note", on: "2026-11-10", note: "Pretend first go" }] }));
  const sheet = await tickOn("/area/writing", "Pretend redo");
  await userEvent.type(within(sheet).getByRole("textbox"), ", then again");
  await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
  await waitFor(async () => expect((await db.items.get("redo"))!.did).toEqual([{ id: "note", on: TODAY, note: "Pretend first go, then again" }]));
});

it("in the Mac app: Attach files copies through the bridge and the names show; macOS saying no is explained kindly", async () => {
  const calls: Record<string, unknown>[] = [];
  let answer: unknown = { saved: [{ name: "draft.docx", folder: "~/Desktop/Writing" }], failed: [] };
  (window as unknown as { webkit: unknown }).webkit = {
    messageHandlers: { [FILES_HANDLER]: { postMessage: async (m: Record<string, unknown>) => (calls.push(m), answer) } },
  };
  await db.items.put(todo("story"));
  const sheet = await tickOn("/area/writing", "Pretend story");
  await userEvent.click(within(sheet).getByRole("button", { name: "Attach files" }));
  expect(await within(sheet).findByRole("button", { name: "draft.docx" })).toBeInTheDocument();
  expect(calls.find((c) => c.action === "attach")).toEqual({ action: "attach", root: "~/Desktop", parts: ["Writing"] });
  expect((await db.items.get("story"))!.did![0]!.files).toEqual([{ name: "draft.docx", folder: "~/Desktop/Writing" }]);
  answer = { error: "permission" };
  await userEvent.click(await within(sheet).findByRole("button", { name: "Attach files" }));
  expect(await within(sheet).findByText(/System Settings, Privacy & Security, Files and Folders/)).toBeInTheDocument();
  await act(async () => undefined);
});
