import { render, screen, within } from "@testing-library/react";
import { db } from "../../data/db";
import type { Item } from "../../domain/types";
import { CompletedThisWeek } from "./CompletedThisWeek";

// The weekly review's read-only "Completed this week" (Esme, 19 Nov 2026). Made-up to-dos.

const SUNDAY = "2026-11-22";
const todo = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: `Pretend ${id}`, links: [], areaId: "writing", priority: 2, status: "done",
  completedAt: "2026-11-18", createdAt: "2026-11-01", touchedAt: "2026-11-01", ...extra,
});

beforeEach(async () => {
  await db.items.clear();
});

it("the to-dos done this week, Monday to Sunday, with their notes; nothing to edit", async () => {
  await db.items.bulkPut([
    todo("chapter", { did: [{ id: "e1", on: "2026-11-18", note: "Pretend wrote the ending" }] }),
    todo("tax", { areaId: "admin", completedAt: "2026-11-16" }),
    todo("old", { completedAt: "2026-11-15" }),
  ]);
  render(<CompletedThisWeek today={SUNDAY} />);
  const list = await screen.findByRole("list", { name: "Completed this week" });
  const rows = within(list).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("Pretend chapter");
  expect(rows[0]).toHaveTextContent("Pretend wrote the ending");
  expect(rows[1]).toHaveTextContent("Pretend tax");
  expect(screen.queryByText("Pretend old")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

it("nothing yet: a calm line", async () => {
  render(<CompletedThisWeek today={SUNDAY} />);
  expect(await screen.findByText("Nothing ticked off yet this week.")).toBeInTheDocument();
});
