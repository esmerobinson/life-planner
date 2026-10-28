import { expect, test } from "@playwright/test";

test("Google Tasks JSON import: add, repeat, list tag, cross-source title check", async ({ page }) => {
  const gt = JSON.stringify({
    lists: [
      {
        id: "l1",
        title: "Garden Jobs",
        tasks: [
          { id: "g1", title: "Prune the pretend roses", status: "needsAction" },
          { id: "g2", title: "Order invented seeds", status: "needsAction" },
          { id: "g3", title: "Already done chore", status: "completed" },
        ],
      },
    ],
  });
  await page.goto("/inbox");

  await page.getByLabel("Google Tasks text").fill(gt);
  await page.getByRole("button", { name: "Import Google Tasks" }).click();
  await expect(page.getByText("Added 2, already had 0, same title as an existing task 0, notes 0")).toBeVisible();
  await page.getByRole("button", { name: "Import Google Tasks" }).click();
  await expect(page.getByText("Added 0, already had 2, same title as an existing task 0, notes 0")).toBeVisible();

  const inbox = page.getByLabel("Inbox items");
  await expect(inbox.getByText("Prune the pretend roses")).toBeVisible();
  await expect(inbox.getByText("Order invented seeds")).toBeVisible();
  await expect(inbox.getByText("#garden jobs").first()).toBeVisible();
  await expect(inbox.getByText("Already done chore")).toHaveCount(0);

  // A title that already came in from the Backlog is not added again.
  await page.getByLabel("Backlog text").fill("- [ ] Sketch the pretend hedgehog");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Added 1, already had 0")).toBeVisible();
  const dup = JSON.stringify({
    lists: [{ id: "l2", title: "Art", tasks: [{ id: "g9", title: "sketch the pretend HEDGEHOG!", status: "needsAction" }] }],
  });
  await page.getByLabel("Google Tasks text").fill(dup);
  await page.getByRole("button", { name: "Import Google Tasks" }).click();
  await expect(page.getByText("Added 0, already had 0, same title as an existing task 1, notes 0")).toBeVisible();
  await expect(inbox.getByText(/sketch the pretend hedgehog/i)).toHaveCount(1);
});
