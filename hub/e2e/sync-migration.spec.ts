import { expect, test } from "@playwright/test";

// A browser that already has data from before sync (database version 1) keeps every row
// when the app upgrades it, and every row is stamped and waiting to be sent. Runs in real
// Chrome IndexedDB, where the change-tracking middleware widens transactions.
test("an existing v1 database upgrades with every row kept, stamped and pending", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded-v1")) return;
    sessionStorage.setItem("seeded-v1", "1");
    // Dexie's version(1) is IndexedDB version 10.
    const req = indexedDB.open("life-hub", 10);
    req.onupgradeneeded = () => {
      const idb = req.result;
      const items = idb.createObjectStore("items", { keyPath: "id" });
      for (const index of ["status", "areaId", "goalId", "due"]) items.createIndex(index, index);
      idb.createObjectStore("goals", { keyPath: "id" });
      items.put({
        id: "old-1", kind: "task", title: "Made before sync existed", links: [], areaId: "art", priority: 2,
        status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01",
      });
      req.transaction!.objectStore("goals").put({
        id: "old-g", title: "An old goal", areaId: "art", kind: "practice", milestones: [], createdAt: "2026-10-01",
      });
    };
    req.onsuccess = () => req.result.close();
  });

  await page.goto("/area/art");
  await expect(page.getByText("Made before sync existed")).toBeVisible();

  const stored = await page.evaluate(
    () =>
      new Promise<{ version: number; items: { updatedAt?: number }[]; pending: unknown[] }>((resolve, reject) => {
        const req = indexedDB.open("life-hub");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const idb = req.result;
          const tx = idb.transaction(["items", "pending"], "readonly");
          const items = tx.objectStore("items").getAll();
          const pending = tx.objectStore("pending").getAll();
          tx.oncomplete = () => {
            resolve({ version: idb.version, items: items.result, pending: pending.result });
            idb.close();
          };
        };
      }),
  );
  expect(stored.version).toBe(50); // Dexie version 5 (journal round: journal)
  expect(stored.items).toHaveLength(1);
  expect(typeof stored.items[0]!.updatedAt).toBe("number");
  expect(stored.pending).toHaveLength(2);
});

test("the Sync page is reachable from the sidebar and keeps the passphrase out of view", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Sync" }).click();
  await expect(page.getByRole("heading", { name: "Sync" })).toBeVisible();
  await expect(page.getByLabel("Passphrase")).toHaveAttribute("type", "password");
  await expect(page.getByText("Sync is off on this device.")).toBeVisible();
});
