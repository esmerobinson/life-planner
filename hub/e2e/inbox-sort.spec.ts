import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* Inbox "Sort one by one" (layout B) and the Bin in a real browser. All data is
   fictional. Set SHOTS_DIR to also save screenshots. */

type Row = Record<string, unknown>;

async function seed(page: Page, items: Row[]) {
  await page.evaluate(async (is) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open("life-hub");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(["items"], "readwrite");
      for (const r of is) tx.objectStore("items").put(r);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, items);
}

/** Five made-up inbox items, oldest first (the queue's order). */
async function seedInbox(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const today = await pageDate(page, 0);
  const day = async (n: number) => pageDate(page, -10 + n);
  const row = async (id: string, title: string, n: number, extra: Row = {}): Promise<Row> => ({
    id, kind: "task", title, links: [], areaId: "inbox", priority: 2, status: "open",
    createdAt: await day(n), touchedAt: today, ...extra,
  });
  await seed(page, [
    await row("s1", "Ask the pretend neighbour about the 1970s street party", 1, { tags: ["from-daily-notes"] }),
    await row("s2", "A carousel about first drafts being allowed to be bad (pretend)", 2, {
      tags: ["from-daily-notes"], notes: "Maybe five slides",
    }),
    await row("s3", "Renew the pretend library card", 3, { source: { kind: "gtasks", key: "gtasks:p1" } }),
    await row("s4", "Learn to draw pretend hands properly", 4),
    await row("s5", "Try a pretend sound bath class", 5),
  ]);
}

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

const card = (page: Page) => page.getByRole("region", { name: "Item to sort" });

test("sort one by one: To-do, Idea, Goal, Skip, Archive, Delete, Undo and the Bin", async ({ page }) => {
  await seedInbox(page);
  await page.goto("/inbox");
  await expect(page.getByText("5 to sort")).toBeVisible();
  await shoot(page, "inbox-list-1280");
  await page.getByRole("link", { name: "Sort one by one" }).click();
  await expect(page).toHaveURL(/\/inbox\/sort$/);

  // Step 1: nothing chosen yet.
  await expect(card(page).getByText("Ask the pretend neighbour about the 1970s street party")).toBeVisible();
  await expect(card(page).getByText("from Obsidian · daily notes")).toBeVisible();
  await expect(card(page).getByText("Which area?")).toHaveCount(0);
  await expect(page.getByText("1 of 5")).toBeVisible();
  await shoot(page, "sort-step1-1280");

  // To-do into Writing.
  await card(page).getByRole("button", { name: "To-do" }).click();
  await expect(card(page).getByRole("button", { name: "← To-do · change" })).toBeVisible();
  await shoot(page, "sort-step2-1280");
  await card(page).getByRole("button", { name: "Writing" }).click();
  await expect(page.getByText("Filed as To-do in Writing · Undo")).toBeVisible();

  // Idea into Content, with a note typed first (2 in the notes box is just text).
  await expect(card(page).getByText(/A carousel about first drafts/)).toBeVisible();
  const notes = card(page).getByRole("textbox", { name: "Notes" });
  await expect(notes).toHaveValue("Maybe five slides");
  await notes.click();
  await notes.press("End");
  await notes.pressSequentially(", 2 of them funny");
  await expect(card(page).getByText("What is it?")).toBeVisible();
  await page.keyboard.press("Escape"); // leaves the box only
  await page.keyboard.press("2");
  await expect(card(page).getByRole("button", { name: "← Idea · change" })).toBeVisible();
  await card(page).getByRole("button", { name: "Content" }).click();
  await expect(page.getByText("Filed as Idea in Content · Undo")).toBeVisible();

  // Skip, then Archive, then Delete; Undo the delete; then Goal.
  await expect(card(page).getByText("Renew the pretend library card")).toBeVisible();
  await expect(card(page).getByText("from Google Tasks")).toBeVisible();
  await card(page).getByRole("button", { name: "Skip →" }).click();
  await expect(page.getByText("Skipped (it comes back at the end)")).toBeVisible();
  await card(page).getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived · Undo")).toBeVisible();
  await card(page).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Moved to the Bin · Undo")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(card(page).getByText("Try a pretend sound bath class")).toBeVisible();
  await page.keyboard.press("3");
  await card(page).getByRole("button", { name: "Mind" }).click();
  await expect(page.getByText("Filed as Goal in Mind")).toBeVisible();

  // The skipped one came back at the end; delete it for real.
  await expect(card(page).getByText("Renew the pretend library card")).toBeVisible();
  await expect(page.getByText("1 of 1")).toBeVisible();
  await card(page).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("All sorted")).toBeVisible();
  await expect(page.getByTestId("celebration-placeholder")).toBeVisible();

  // Where things went.
  await page.goto("/area/content");
  await expect(page.getByText(/A carousel about first drafts/)).toBeVisible();
  await page.goto("/goals");
  await expect(page.getByText("Try a pretend sound bath class")).toBeVisible();

  // The Bin: restore, delete again, then empty with a confirmation.
  await page.getByRole("link", { name: "Bin", exact: true }).click();
  const bin = page.getByRole("list", { name: "In the bin" });
  await expect(bin.getByText("Renew the pretend library card")).toBeVisible();
  await shoot(page, "bin-1280");
  await page.getByRole("button", { name: "Empty bin" }).click();
  await expect(page.getByText("Delete 1 item for good? This can't be undone.")).toBeVisible();
  await shoot(page, "bin-confirm-1280");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Restore: Renew the pretend library card" }).click();
  await expect(page.getByText("The bin is empty.")).toBeVisible();
  await page.goto("/inbox");
  await page.getByRole("button", { name: "Delete: Renew the pretend library card" }).click();
  await expect(page.getByText("Moved to the Bin · Undo")).toBeVisible();
  await page.goto("/bin");
  await page.getByRole("button", { name: "Empty bin" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("The bin is empty.")).toBeVisible();
  // Gone everywhere, and survives a reload.
  await page.reload();
  await expect(page.getByText("The bin is empty.")).toBeVisible();
  await page.goto("/inbox");
  await expect(page.getByText("Nothing waiting in the inbox.")).toBeVisible();
});

test("delete from an area strip and delete a goal: both in the Bin, both restorable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  // Make a task and a goal through the app itself.
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel("Title").fill("Pretend chore to delete");
  await page.getByRole("combobox", { name: "Area", exact: true }).selectOption({ label: "Art" });
  await page.getByRole("button", { name: "Add item" }).click();
  await page.goto("/area/art");
  await page.getByRole("button", { name: "Move to: Pretend chore to delete" }).click();
  await page.getByRole("group", { name: "Move Pretend chore to delete to" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Pretend chore to delete")).toHaveCount(0);

  await page.goto("/inbox");
  await page.getByRole("textbox", { name: "Add to inbox" }).fill("Pretend goal to delete");
  await page.getByRole("textbox", { name: "Add to inbox" }).press("Enter");
  await page.getByRole("link", { name: "Sort one by one" }).click();
  await expect(card(page).getByText("Pretend goal to delete")).toBeVisible();
  await card(page).getByRole("button", { name: "Goal" }).click();
  await card(page).getByRole("button", { name: "Body" }).click();
  await expect(page.getByText("Filed as Goal in Body")).toBeVisible();
  await page.goto("/goals");
  await page.getByRole("link", { name: "Pretend goal to delete" }).click();
  await page.getByRole("button", { name: "Delete goal" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Goals" })).toBeVisible();
  await expect(page.getByText("Pretend goal to delete")).toHaveCount(0);

  await page.goto("/bin");
  const bin = page.getByRole("list", { name: "In the bin" });
  await expect(bin.getByRole("listitem")).toHaveCount(2);
  await expect(bin.getByRole("listitem").filter({ hasText: "Pretend goal to delete" }).getByText("Goal", { exact: true })).toBeVisible();
  await shoot(page, "bin-with-goal-1280");
  await page.getByRole("button", { name: "Restore: Pretend goal to delete" }).click();
  await page.getByRole("button", { name: "Restore: Pretend chore to delete" }).click();
  await expect(page.getByText("The bin is empty.")).toBeVisible();
  await page.goto("/goals");
  await expect(page.getByText("Pretend goal to delete")).toBeVisible();
  await page.goto("/area/art");
  await expect(page.getByText("Pretend chore to delete")).toBeVisible();
});

test("Escape goes back to the Inbox", async ({ page }) => {
  await seedInbox(page);
  await page.goto("/inbox/sort");
  await expect(card(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/inbox$/);
});

test.describe("phone width (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** Hides the 220px sidebar to see the content at the full phone width (the phone round removes it). */
  async function contentAtFullWidth(page: Page) {
    await page.addStyleTag({ content: ".sidebar { display: none; }" });
  }

  async function expectNoSideScroll(page: Page) {
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(wide).toBe(false);
  }

  test("inbox, both sort steps and the Bin fit the phone width", async ({ page }) => {
    await seedInbox(page);
    await page.goto("/inbox");
    await expect(page.getByText("5 to sort")).toBeAttached();
    await shoot(page, "inbox-list-390");
    await contentAtFullWidth(page);
    await shoot(page, "inbox-list-390-content");
    await expectNoSideScroll(page);

    await page.goto("/inbox/sort");
    await contentAtFullWidth(page);
    await expect(card(page)).toBeVisible();
    await shoot(page, "sort-step1-390-content");
    await expectNoSideScroll(page);
    const cardBox = (await card(page).boundingBox())!;
    expect(cardBox.width).toBeGreaterThan(390 - 2 * 24 - 2); // full width inside the content padding
    await card(page).getByRole("button", { name: "Idea" }).click();
    // Three apps per row on a phone.
    const apps = card(page).getByRole("group", { name: "Which area?" }).getByRole("button");
    const tops = await apps.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(tops.filter((t) => t === tops[0])).toHaveLength(3);
    await shoot(page, "sort-step2-390-content");
    await expectNoSideScroll(page);

    await card(page).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Moved to the Bin · Undo")).toBeVisible();
    await page.goto("/bin");
    await expect(page.getByRole("list", { name: "In the bin" })).toBeAttached();
    await shoot(page, "bin-390");
    await contentAtFullWidth(page);
    await shoot(page, "bin-390-content");
    await expectNoSideScroll(page);
  });

  test("the sort card with the real sidebar (until the phone layout lands)", async ({ page }) => {
    await seedInbox(page);
    await page.goto("/inbox/sort");
    await expect(card(page)).toBeAttached();
    await shoot(page, "sort-step1-390");
    await card(page).getByRole("button", { name: "Goal" }).click();
    await shoot(page, "sort-step2-390");
  });
});
