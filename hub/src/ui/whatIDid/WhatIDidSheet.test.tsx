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

it("a click on the dimmed page closes it too", async () => {
  await db.items.put(todo("walk", { areaId: "body" }));
  const sheet = await tickOn("/area/body", "Pretend walk");
  await userEvent.pointer({ keys: "[MouseLeft]", target: sheet.parentElement! });
  expect(screen.queryByRole("dialog")).toBeNull();
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
  expect(calls[0]).toEqual({ action: "attach", root: "~/Desktop", parts: ["Writing"] });
  expect((await db.items.get("story"))!.did![0]!.files).toEqual([{ name: "draft.docx", folder: "~/Desktop/Writing" }]);
  answer = { error: "permission" };
  await userEvent.click(await within(sheet).findByRole("button", { name: "Attach files" }));
  expect(await within(sheet).findByText(/System Settings, Privacy & Security, Files and Folders/)).toBeInTheDocument();
  await act(async () => undefined);
});
