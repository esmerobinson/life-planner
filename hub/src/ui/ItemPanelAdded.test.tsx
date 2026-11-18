import { screen, within } from "@testing-library/react";
import { markTransactionUntracked } from "../data/changeTracking";
import { db } from "../data/db";
import { createItem } from "../data/repo";
import { renderApp } from "../test/renderApp";

// "Date added" on every to-do (Esme's list, 2026-11): in its side panel, the last property,
// "Added  12 Nov". Wording and placement provisional for Design. Fictional items only.

const TODAY = "2026-11-18";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

const keys = (panel: HTMLElement) => [...panel.querySelectorAll(".peek-props > .peek-key")].map((k) => k.textContent);

it("a to-do's panel says when it was added, as its last property", async () => {
  const t = await createItem({ kind: "task", title: "Pretend added job", areaId: "art", priority: 2 }, "2026-11-12");
  renderApp(`/area/art?open=${t.id}`, TODAY);
  const panel = await screen.findByRole("complementary", { name: "Pretend added job" });
  expect(within(panel).getByText("Added")).toHaveClass("peek-key");
  expect(within(panel).getByText("12 Nov")).toBeInTheDocument();
  expect(keys(panel).at(-1)).toBe("Added");
});

it("the year shows when it isn't this year; an Inbox item has it too", async () => {
  const t = await createItem({ kind: "task", title: "Pretend old inbox job", areaId: "inbox", priority: 2 }, "2025-03-04");
  renderApp(`/inbox?open=${t.id}`, TODAY);
  const panel = await screen.findByRole("complementary", { name: "Pretend old inbox job" });
  expect(within(panel).getByText("4 Mar 2025")).toBeInTheDocument();
});

it("an imported to-do says Imported (the day it came in), not Added", async () => {
  const t = await createItem(
    { kind: "task", title: "Pretend imported job", areaId: "art", priority: 2, source: { kind: "gtasks", key: "pretend-key" } },
    "2026-10-28",
  );
  renderApp(`/area/art?open=${t.id}`, TODAY);
  const panel = await screen.findByRole("complementary", { name: "Pretend imported job" });
  expect(within(panel).getByText("Imported")).toHaveClass("peek-key");
  expect(within(panel).getByText("28 Oct")).toBeInTheDocument();
  expect(within(panel).queryByText("Added")).toBeNull();
});

it("no real date: no line at all, never a wrong date", async () => {
  const t = await createItem({ kind: "task", title: "Pretend dateless job", areaId: "art", priority: 2 }, TODAY);
  // A row whose date is missing (written past the validator, as a very old copy might be).
  await db.transaction("rw", db.items, async (tx) => {
    markTransactionUntracked(tx);
    const { createdAt: _c, ...rest } = (await db.items.get(t.id))!;
    await db.items.put(rest as never);
  });
  renderApp(`/area/art?open=${t.id}`, TODAY);
  const panel = await screen.findByRole("complementary", { name: "Pretend dateless job" });
  expect(within(panel).queryByText("Added")).toBeNull();
  expect(within(panel).queryByText("Imported")).toBeNull();
});
