import { expect, test } from "@playwright/test";

test("a change in one tab shows in another without reload", async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto("/");
  await b.goto("/inbox");
  await expect(b.getByText("Nothing waiting in the inbox.")).toBeVisible();

  // Add in A, see it in B's Inbox.
  await a.getByRole("button", { name: "Add", exact: true }).click();
  await a.getByLabel("Title").fill("Cross tab pretend errand");
  await a.getByRole("button", { name: "Add item" }).click();
  await expect(b.getByText("Cross tab pretend errand")).toBeVisible();

  // File it into Art in B (priority 2 fills Today), then both tabs show it on Today.
  await b.getByLabel("Area for Cross tab pretend errand").selectOption({ label: "Art" });
  await b.getByRole("button", { name: "File Cross tab pretend errand" }).click();
  await a.goto("/today");
  await b.goto("/today");
  await expect(a.getByRole("button", { name: "Done: Cross tab pretend errand" })).toBeVisible();
  await expect(b.getByRole("button", { name: "Done: Cross tab pretend errand" })).toBeVisible();

  // Tick in B, A's Today updates without reload.
  await b.getByRole("button", { name: "Done: Cross tab pretend errand" }).click();
  await expect(a.getByRole("button", { name: "Done: Cross tab pretend errand" })).toHaveCount(0);
});
