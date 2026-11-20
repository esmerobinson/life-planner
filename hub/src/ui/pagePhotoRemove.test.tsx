import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { pictureLine } from "../domain/page";
import type { Item } from "../domain/types";
import { renderApp } from "../test/renderApp";
import { PAGE_WORDS } from "./PageEditor";

// A picture taken off a to-do's page in the side panel is noted for deleting (review I1), because
// the panel saves with the text its editor showed (re-review RI1). Made-up rows only.

const DAY = "2026-11-20";
const todo = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: `Pretend ${id}`, links: [], areaId: "art", priority: 2, status: "open",
  createdAt: DAY, touchedAt: DAY, ...extra,
});

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.files.clear(), db.syncMeta.clear()]);
});
afterEach(() => vi.useRealTimers());

it("Remove picture in the panel: the page is saved without it and the photo is noted for deleting", async () => {
  await db.files.add({ id: "pg1", mime: "image/jpeg", data: "/9j/4AAQ", width: 40, height: 30, createdAt: DAY });
  await db.items.put(todo("mural", { notes: `words\n${pictureLine("pg1")}` }));
  renderApp("/area/art?open=mural", DAY);
  await userEvent.click(await screen.findByRole("button", { name: PAGE_WORDS.removePicture }));
  await waitFor(async () => expect((await db.items.get("mural"))!.notes).toBe("words"), { timeout: 3000 });
  const noted = (await db.syncMeta.get("removedPhotos"))?.value as { id: string; row: string }[];
  expect(noted).toEqual([expect.objectContaining({ id: "pg1", row: "mural" })]);
});
