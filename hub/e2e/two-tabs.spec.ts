import { expect, test, type Page } from "@playwright/test";

type Marked = { __marker?: number };

/** Set once after the initial load; if it survives, the page never did a document load. */
async function mark(page: Page) {
  await page.evaluate(() => {
    (window as unknown as Marked).__marker = 1;
  });
}
async function expectNoReload(page: Page) {
  expect(await page.evaluate(() => (window as unknown as Marked).__marker)).toBe(1);
}

test("an item added in one tab shows in another tab's Inbox without reload", async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto("/");
  await b.goto("/inbox");
  await expect(b.getByText("Nothing waiting in the inbox.")).toBeVisible();
  await mark(b); // B never navigates or reloads after this point

  await a.getByRole("button", { name: "Add", exact: true }).click();
  await a.getByLabel("Title").fill("Cross tab pretend errand");
  await a.getByRole("button", { name: "Add item" }).click();

  await expect(b.getByText("Cross tab pretend errand")).toBeVisible();
  await expectNoReload(b);
});

test("a tick in one tab updates another tab's Today without reload", async ({ context }) => {
  const a = await context.newPage();
  await a.goto("/");

  // Seed one item: add it, then file it into Art (priority 2 makes it a Today pick).
  await a.getByRole("button", { name: "Add", exact: true }).click();
  await a.getByLabel("Title").fill("Cross tab pretend errand");
  await a.getByRole("button", { name: "Add item" }).click();
  await a.getByRole("link", { name: /^Inbox/ }).click();
  await a.getByRole("button", { name: "Move to: Cross tab pretend errand" }).click();
  await a.getByRole("group", { name: "Move Cross tab pretend errand to" }).getByRole("button", { name: "Art" }).click();

  const b = await context.newPage();
  await b.goto("/");

  // Reach Today in both by in-app navigation (no document load), then mark B.
  for (const p of [a, b]) {
    await p.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Today" }).click();
    await expect(p.getByRole("heading", { name: "Today" }).first()).toBeVisible();
  }
  await mark(b);
  const done = (p: Page) => p.getByRole("checkbox", { name: "Mark done: Cross tab pretend errand" });
  await expect(done(a)).toBeVisible();
  await expect(done(b)).toBeVisible();

  await done(b).click();
  await expect(done(a)).toHaveCount(0);
  await expectNoReload(b);
});
