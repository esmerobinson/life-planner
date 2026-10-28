import { expect, test } from "@playwright/test";

test("Inbox: quick capture, filter by source, archive, restore, delete to the Bin, Move to filing", async ({ page }) => {
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
  await expect(page.getByText("3 to sort")).toBeVisible();
  // No multi-select anywhere.
  await expect(page.getByRole("checkbox")).toHaveCount(0);

  // Quick capture: several thoughts in a row, focus stays in the box.
  const box = page.getByRole("textbox", { name: "Add to inbox" });
  await box.fill("Pretend thought one");
  await box.press("Enter");
  await box.fill("Pretend thought two");
  await box.press("Enter");
  await expect(list.getByRole("listitem")).toHaveCount(5);
  await expect(box).toBeFocused();

  // Filter to one source and archive one through Move to.
  const from = page.getByRole("group", { name: "From" });
  await from.getByRole("button", { name: "Backlog" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Move to: Pretend backlog one" }).click();
  await page.getByRole("group", { name: "Move Pretend backlog one to" }).getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("link", { name: "Inbox (4)" })).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(1);

  // It is still there, in the archived list, and can be restored.
  await page.getByText("Archived from the inbox (1)").click();
  await page.getByRole("button", { name: "Restore: Pretend backlog one" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);

  // Delete goes to the Bin, with Undo.
  await from.getByRole("button", { name: "All" }).click();
  await page.getByRole("button", { name: "Delete: Pretend thought one" }).click();
  await expect(page.getByText("Moved to the Bin · Undo")).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await page.getByRole("link", { name: "Bin", exact: true }).click();
  await expect(page.getByRole("list", { name: "In the bin" }).getByText("Pretend thought one")).toBeVisible();
  await page.getByRole("button", { name: "Restore: Pretend thought one" }).click();
  await expect(page.getByText("The bin is empty.")).toBeVisible();

  // Move to an area from a strip, then see it there.
  await page.goto("/inbox");
  await page.getByRole("button", { name: "Move to: Pretend google one" }).click();
  await page.getByRole("group", { name: "Move Pretend google one to" }).getByRole("button", { name: "Art" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await page.goto("/area/art");
  await expect(page.getByText("Pretend google one")).toBeVisible();
});
