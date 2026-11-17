import { expect, test, type Page } from "@playwright/test";

/* Due reminders (2026-11-16) in a real browser: a to-do's time from the Add form shows on its
   strip, and the Reminders page's Due settings land in the synced prefs row. All data is
   fictional; nothing is sent anywhere (sync isn't set up in these tests). */

function readStore(page: Page, store: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (name) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const req = indexedDB.open("life-hub");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const idb = req.result;
          const get = idb.transaction(name, "readonly").objectStore(name).getAll();
          get.onsuccess = () => {
            resolve(get.result as Record<string, unknown>[]);
            idb.close();
          };
          get.onerror = () => reject(get.error);
        };
      }),
    store,
  );
}

test("a to-do's time from the Add form shows on its strip", async ({ page }) => {
  await page.goto("/area/admin");
  await page.getByRole("button", { name: "To-dos", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const form = page.locator("form.quick-add");
  await form.getByLabel("Title").fill("Pretend dentist");
  const today = await page.evaluate(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  await form.getByLabel("Due").fill(today);
  await form.getByLabel("Time").fill("15:00");
  await form.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByRole("list", { name: "To-dos" }).getByText("3:00pm")).toBeVisible();
  const items = await readStore(page, "items");
  expect(items.find((i) => i.title === "Pretend dentist")).toMatchObject({ time: "15:00" });
});

test("the Reminders page's Due settings are saved in the synced row", async ({ page }) => {
  await page.goto("/reminders");
  const due = page.getByRole("region", { name: "Reminders in Due" });
  await expect(due.getByRole("note")).toContainText("Stored on Due's server");
  await due.getByRole("button", { name: "Reminders in Due: Off" }).click();
  await due.getByLabel("Plan your day").fill("08:45");
  await due.getByLabel("New motivation line").fill("Pretend you've got this");
  await due.getByRole("button", { name: "Add line" }).click();
  await expect(due.getByText("Pretend you've got this")).toBeVisible();
  await expect
    .poll(async () => (await readStore(page, "prefs"))[0])
    .toMatchObject({ id: "due", on: true, plan: "08:45", lines: ["Pretend you've got this"] });
  // Marked to go to the sync server.
  expect((await readStore(page, "pending")).some((p) => p.table === "prefs" && p.id === "due")).toBe(true);
  // Still there after a reload.
  await page.reload();
  await expect(page.getByRole("region", { name: "Reminders in Due" }).getByRole("button", { name: "Reminders in Due: On" })).toBeVisible();
});
