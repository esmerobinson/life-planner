import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* The reading list (books are ideas under Mind, 2026-11-04) in a real browser, at computer and
   phone width. FICTIONAL data only. Set SHOTS_DIR to save screenshots. */

async function shoot(page: Page, name: string, fullPage = false) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage });
}

async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/** Pretend books, a plain idea and a to-do under Mind, and an idea in Art. */
async function seed(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const made = await pageDate(page, -10);
  const finished = await pageDate(page, -3);
  await page.evaluate(
    async ({ made, finished }) => {
      const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
      const repo = await at("/src/data/repo.ts");
      const r = await repo.createBook({ title: "Notes on Pretend Staying", author: "Priya Pretend", bookStatus: "reading" }, made);
      await repo.updateBook(r.id, { pages: 300, pageAt: 120 }, made);
      await repo.createBook({ title: "The Pretend Lantern Year", author: "Elsie Madeup", bookStatus: "reading" }, made);
      await repo.createBook({ title: "The Quiet Pretend Hours", author: "Mara Fictional", bookStatus: "want" }, made);
      await repo.createBook({ title: "Small Kind Pretend Habits", bookStatus: "want" }, made);
      await repo.createBook({ title: "Field Guide to Pretend Feelings", author: "Tom Notreal", bookStatus: "read" }, finished);
      await repo.createItem({ kind: "idea", title: "Try a pretend weekend without my phone", areaId: "mind", priority: 2 }, made);
      await repo.createItem({ kind: "task", title: "Look up pretend groups near me", areaId: "mind", priority: 2 }, made);
      await repo.createItem({ kind: "idea", title: "The Gentle Pretend Year by R. Kim", areaId: "art", priority: 2 }, made);
    },
    { made, finished },
  );
}

for (const width of [1280, 390]) {
  test.describe(`reading list at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

    test("Mind's Ideas: the Reading list with the pixel book, strips with author, page and status", async ({ page }) => {
      await seed(page);
      await page.goto("/area/mind");
      const list = page.getByRole("region", { name: "Reading list (5)" });
      await expect(list).toBeVisible();
      const icon = list.locator("img.pixel-icon");
      await expect(icon).toBeVisible();
      // Wait until the picture has loaded before measuring it (a busy machine measured 0 once).
      await expect.poll(() => icon.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(16);
      // The pixel book: 16px, pixelated, and really the sprite (16×16 pixels, not a placeholder).
      const look = await icon.evaluate((el: HTMLImageElement) => ({
        w: el.getBoundingClientRect().width,
        h: el.getBoundingClientRect().height,
        rendering: getComputedStyle(el).imageRendering,
        natural: [el.naturalWidth, el.naturalHeight],
      }));
      expect(look).toEqual({ w: 16, h: 16, rendering: "pixelated", natural: [16, 16] });
      const first = list.getByRole("listitem").first();
      await expect(first).toContainText("Notes on Pretend Staying");
      await expect(first).toContainText("Priya Pretend · page 120 of 300");
      await expect(first.locator(".book-pill")).toHaveText("Reading");
      await expect(first.getByRole("progressbar")).toBeVisible();
      await noSideways(page);
      await list.scrollIntoViewIfNeeded();
      await shoot(page, `reading-list-${width}`);

      await page.getByRole("button", { name: "Books" }).click();
      await expect(page.getByText("Look up pretend groups near me")).toHaveCount(0);
      await expect(list).toBeVisible();
      await shoot(page, `reading-list-books-pill-${width}`, true);
    });

    test("Change to → Book moves an idea to Mind with Undo; the book's panel switches status", async ({ page }) => {
      await seed(page);
      await page.goto("/area/art");
      await page.getByRole("button", { name: "Move to: The Gentle Pretend Year by R. Kim" }).click();
      await shoot(page, `change-to-book-menu-${width}`);
      await page.getByRole("group", { name: "Change to" }).getByRole("button", { name: "Book" }).click();
      await expect(page.getByText(/^Moved to Mind's reading list/)).toBeVisible();
      await shoot(page, `change-to-book-undo-${width}`);

      await page.goto("/area/mind");
      const list = page.getByRole("region", { name: "Reading list (6)" });
      await list.getByRole("button", { name: "Notes on Pretend Staying", exact: true }).click();
      const panel = page.getByRole("complementary", { name: "Notes on Pretend Staying" });
      await expect(panel.getByText("page 120 of 300")).toBeVisible();
      await shoot(page, `book-panel-${width}`);
      await panel.getByRole("group", { name: "Status" }).getByRole("button", { name: "Read", exact: true }).click();
      await expect(panel.getByText("Finished")).toBeVisible();
      await noSideways(page);
      await shoot(page, `book-panel-read-${width}`);
    });

    test("Add → Type Book shows Author and Status", async ({ page }) => {
      await seed(page);
      await page.goto("/area/mind");
      await page.getByRole("region", { name: "Reading list (5)" }).getByRole("button", { name: "+ Add a book" }).click();
      const form = page.getByRole("dialog", { name: "Add" });
      await expect(form.getByLabel("Type")).toHaveValue("book");
      await form.getByLabel("Title").fill("Salt and Pretend Weather");
      await form.getByLabel("Author").fill("Ines Invented");
      await shoot(page, `add-book-${width}`);
      await form.getByRole("button", { name: "Add item" }).click();
      await expect(page.getByRole("region", { name: "Reading list (6)" })).toContainText("Salt and Pretend Weather");
    });
  });
}
