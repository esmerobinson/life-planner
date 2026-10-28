import { expect, test } from "@playwright/test";

const GOALS = [
  "# Goals",
  "## Writing",
  "- Identity: Finishes small pretend stories.",
  "- Weekly: 3 sessions",
  "- Marker: Publish 1 pretend story by 1 Jun 2027",
  "## Gardening corner",
  "- Identity: Tends imaginary tomatoes.",
].join("\n");

const MONTH = [
  "# Goals for February 2028",
  "## This month's goals",
  "*   **Paint the pretend fence (outdoors):** Two coats, no rush.",
  "    *   Next step: Buy the fictional paint",
].join("\n");

test("Obsidian goals import: preview, add selected, repeat shows Already added", async ({ page }) => {
  await page.goto("/goals");
  await page.getByRole("link", { name: "Import from Obsidian" }).click();
  await expect(page).toHaveURL(/\/goals\/import$/);

  await page.getByLabel("Goals note text").fill(GOALS);
  await page.getByLabel("Monthly note text").fill(MONTH);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
  await expect(page.getByLabel("Area for Gardening corner")).toHaveValue("admin");
  await expect(page.getByLabel("Deadline for Paint the pretend fence")).toHaveValue("2028-02-29");

  // Nothing is written by the preview.
  await page.goto("/goals");
  await expect(page.getByText("No goals yet.")).toBeVisible();
  await page.getByRole("link", { name: "Import from Obsidian" }).click();
  await page.getByLabel("Goals note text").fill(GOALS);
  await page.getByLabel("Monthly note text").fill(MONTH);
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: "Add selected" }).click();
  await expect(page.getByText("Added 3 goals and 1 tasks, already had 0.")).toBeVisible();

  await page.getByRole("link", { name: "Back to Goals" }).click();
  const list = page.getByRole("list", { name: "Goals" });
  await expect(list.getByRole("link", { name: "Writing", exact: true })).toBeVisible();
  await expect(list.getByRole("link", { name: "Gardening corner" })).toBeVisible();
  await list.getByRole("link", { name: "Paint the pretend fence" }).click();
  await expect(page.getByText("Buy the fictional paint")).toBeVisible();

  // Repeat: everything is Already added.
  await page.goto("/goals/import");
  await page.getByLabel("Goals note text").fill(GOALS);
  await page.getByLabel("Monthly note text").fill(MONTH);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("Already added")).toHaveCount(4);
});
