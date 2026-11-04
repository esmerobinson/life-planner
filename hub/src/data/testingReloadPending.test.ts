// Testing session (reload area): changes made offline wait in `pending` and must still be there
// after the app is closed and opened again (a reload is a new connection to the same database),
// with the row's own stamp, so the next sync sends them. What Esme would see if this failed: an
// edit made offline never reaching her other device. Fictional data only.

import Dexie from "dexie";
import { HubDB } from "./db";
import type { Item } from "../domain/types";

const item = (id: string): Item => ({
  id, kind: "task", title: `Pretend ${id}`, links: [], areaId: "art", priority: 2,
  status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01",
});

describe("pending changes survive a reload", () => {
  it("an edit made before closing is still pending, with its stamp, after reopening", async () => {
    const name = `reload-${crypto.randomUUID()}`;
    const first = new HubDB(name);
    await first.items.add(item("a"));
    await first.items.update("a", { title: "Pretend edited offline" });
    const stamp = (await first.items.get("a"))!.updatedAt;
    first.close();

    const again = new HubDB(name);
    expect(await again.items.get("a")).toMatchObject({ title: "Pretend edited offline", updatedAt: stamp });
    expect(await again.pending.toArray()).toEqual([{ table: "items", id: "a", updatedAt: stamp }]);
    again.close();
    await Dexie.delete(name);
  });
});
