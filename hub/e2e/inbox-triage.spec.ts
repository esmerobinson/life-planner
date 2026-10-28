import { expect, test } from "@playwright/test";

test("Inbox: quick capture, filter by source, select all shown, archive, restore, one-tap filing", async ({ page }) => {
  // Seed from two sources through the (moved) import panels on the Backup page.
  await page.goto("/backup");
  await page.getByText("Import from a file", { exact: true }).click();
  await page.getByLabel("Backlog text").fill("- [ ] Pretend backlog one\n- [ ] Pretend backlog two");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Added 2, already had 0")).toBeVisible();
  await page.getByLabel("Google Tasks text").fill(
    JSON.stringify({
      lists: [{ id: "l", title: "Chores", tasks: [{ id: "c1", title: "Pretend google one", status: "needsAction" }] }],
    }),
  );
  await page.getByRole("button", { name: "Import Google Tasks" }).click();
  await expect(page.getByText(/^Added 1, already had 0/)).toBeVisible();

  await page.getByRole("link", { name: /^Inbox/ }).click();
  const list = page.getByLabel("Inbox items");
  await expect(list.getByRole("listitem")).toHaveCount(3);

  // Quick capture: several thoughts in a row, focus stays in the box.
  const box = page.getByRole("textbox", { name: "Add to inbox" });
  await box.fill("Pretend thought one");
  await box.press("Enter");
  await box.fill("Pretend thought two");
  await box.press("Enter");
  await expect(list.getByRole("listitem")).toHaveCount(5);
  await expect(box).toBeFocused();

  // Filter to one source, select all shown, archive.
  const from = page.getByRole("group", { name: "From" });
  await from.getByRole("button", { name: "Backlog" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await page.getByLabel("Select all shown").check();
  await page.getByRole("button", { name: "Archive selected" }).click();
  await expect(page.getByText(/^Archived 2\./)).toBeVisible();
  await expect(page.getByRole("link", { name: "Inbox (3)" })).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(3);

  // They are still there, in the archived list, and can be restored.
  await page.getByText("Archived from the inbox (2)").click();
  await page.getByRole("button", { name: "Restore: Pretend backlog one" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(4);

  // One-tap filing into an area, then see it there.
  await page.getByRole("button", { name: "File Pretend google one in Art" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await page.goto("/area/art");
  await expect(page.getByText("Pretend google one")).toBeVisible();
});
