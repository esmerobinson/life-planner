import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* Esme's app design queue picks (all A, 2026-11-17), in a real browser at computer and phone
   width: Repeating's sidebar row / phone app, its day buttons and week, the goal panel's pills,
   highlights with a note and their Read back tile, and Home's "Coming up (N)".
   FICTIONAL data only. Set SHOTS_DIR to save screenshots. */

async function shoot(page: Page, name: string, fullPage = false) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage });
}

async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/** Runs `fn(repo, args)` in the page with the app's own repo module (dev server). */
async function withRepo<A>(page: Page, args: A, fn: string) {
  await page.evaluate(
    async ({ args, fn }) => {
      const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
      const repo = await at("/src/data/repo.ts");
      await new Function("repo", "args", `return (async () => { ${fn} })()`)(repo, args);
    },
    { args, fn },
  );
}

async function home(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today" }).first()).toBeVisible();
}

/** Pretend repeats in Body, Writing, Art and Admin; the walk ticked today. */
async function seedRepeats(page: Page) {
  await home(page);
  const made = await pageDate(page, -10);
  const today = await pageDate(page, 0);
  await withRepo(
    page,
    { made, today },
    `const t = { kind: "task", priority: 2 };
     const walk = await repo.createItem({ ...t, title: "Pretend evening walk", areaId: "body", recur: ["mon", "wed", "fri"] }, args.made);
     await repo.createItem({ ...t, title: "Stretch for ten pretend minutes", areaId: "body", recur: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] }, args.made);
     await repo.createItem({ ...t, title: "Write 300 pretend words", areaId: "writing", recur: ["mon", "tue", "wed", "thu", "fri"] }, args.made);
     await repo.createItem({ ...t, title: "Sketch for 20 pretend minutes", areaId: "art", recur: ["tue", "thu"] }, args.made);
     await repo.createItem({ ...t, title: "Water the pretend plants", areaId: "admin", recur: ["sat"] }, args.made);
     await repo.tickItem(walk.id, args.today);`,
  );
}

for (const width of [1280, 390]) {
  const phone = width === 390;
  test.describe(`app design queue at ${width}px`, () => {
    test.use({ viewport: { width, height: phone ? 844 : 900 } });

    test("Repeating: its own row under Goals (sidebar) or app (phone grid), coral tile", async ({ page }) => {
      await home(page);
      const nav = page.getByRole("navigation", { name: "Main" });
      const links = nav.getByRole("link");
      const names = await links.allTextContents();
      const at = names.findIndex((n) => n.trim() === "Repeating");
      expect(names[at - 1].trim()).toBe("Goals");
      const link = links.nth(at);
      await expect(link).toHaveAttribute("href", "/repeating");
      const tile = link.locator(phone ? ".phone-app-tile" : ".sidebar-tile");
      await expect(tile).toHaveCSS("background-color", "rgb(223, 126, 111)");
      // The old footer link is gone; the page is reachable from the row.
      await expect(page.getByRole("link", { name: "Repeating" })).toHaveCount(1);
      await shoot(page, `1-repeating-where-${width}`);
      await link.click();
      await expect(page).toHaveURL(/\/repeating$/);
      await expect(page.getByRole("heading", { level: 1, name: "Repeating" })).toBeAttached();
    });

    test("Repeating: day buttons on every row, a tap saves, the last day stays; Stop and Delete in the … menu", async ({ page }) => {
      await seedRepeats(page);
      await page.goto("/repeating");
      const walk = page.getByRole("group", { name: "Repeats on: Pretend evening walk" });
      await expect(walk.getByRole("button")).toHaveText(["M", "T", "W", "T", "F", "S", "S"]);
      await expect(walk.getByRole("button", { pressed: true })).toHaveCount(3);
      const on = walk.getByRole("button", { name: "Monday" });
      await expect(on).toHaveCSS("background-color", "rgb(152, 194, 147)");
      await expect(walk.getByRole("button", { name: "Tuesday" })).toHaveCSS("background-color", "rgb(228, 207, 164)");
      await expect(on).toHaveCSS("width", "28px");
      await shoot(page, `2-repeating-days-${width}`, true);
      await noSideways(page);

      // Tuesday on: saved at once (still on after a reload).
      await walk.getByRole("button", { name: "Tuesday" }).click();
      await expect(walk.getByRole("button", { name: "Tuesday" })).toHaveAttribute("aria-pressed", "true");
      await page.reload();
      await expect(page.getByRole("group", { name: "Repeats on: Pretend evening walk" }).getByRole("button", { name: "Tuesday" })).toHaveAttribute("aria-pressed", "true");

      // The last day can't go.
      const plants = page.getByRole("group", { name: "Repeats on: Water the pretend plants" });
      await plants.getByRole("button", { name: "Saturday" }).click();
      await expect(page.getByText(/It has to repeat on at least one day/)).toBeVisible();
      await expect(plants.getByRole("button", { name: "Saturday" })).toHaveAttribute("aria-pressed", "true");
      await shoot(page, `2-repeating-last-day-${width}`);

      // Stop repeating and Delete are in the … menu.
      await expect(page.getByRole("button", { name: "Stop repeating: Pretend evening walk" })).toHaveCount(0);
      await page.getByRole("button", { name: "More: Pretend evening walk" }).click();
      const menu = page.getByRole("group", { name: "More for Pretend evening walk" });
      await expect(menu.getByRole("button")).toHaveText(["Stop repeating", "Delete"]);
      await shoot(page, `2-repeating-menu-${width}`);
      await menu.getByRole("button", { name: "Delete: Pretend evening walk" }).click();
      await expect(page.getByText("Moved to the Bin: Pretend evening walk")).toBeVisible();
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(page.getByRole("button", { name: "More: Pretend evening walk" })).toBeVisible();
    });

    test("Repeating: This week shows Monday to Sunday, today outlined; stacked on the phone", async ({ page }) => {
      await seedRepeats(page);
      await page.goto("/repeating");
      await page.getByRole("button", { name: "This week" }).click();
      const days = page.locator(".week-day");
      await expect(days).toHaveCount(7);
      await expect(days.locator("h2")).toHaveText([/^Mon /, /^Tue /, /^Wed /, /^Thu /, /^Fri /, /^Sat /, /^Sun /]);
      const today = page.locator(".week-day.is-today");
      await expect(today).toHaveCount(1);
      await expect(today.locator("h2")).toContainText("today");
      await expect(today).toHaveCSS("outline-style", "solid");
      // Every repeat lands on its days; Stretch is on all seven.
      await expect(page.locator(".week-mini", { hasText: "Stretch for ten pretend minutes" })).toHaveCount(7);
      await expect(page.locator(".week-mini", { hasText: "Water the pretend plants" })).toHaveCount(1);
      await expect(days.nth(5)).toContainText("Water the pretend plants");
      const boxes = await days.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
      if (phone) {
        for (let i = 1; i < 7; i++) expect(boxes[i].top).toBeGreaterThan(boxes[i - 1].bottom - 1);
      } else {
        for (let i = 1; i < 7; i++) expect(Math.abs(boxes[i].top - boxes[0].top)).toBeLessThan(1);
      }
      await shoot(page, `3-repeating-week-${width}`, true);
      await noSideways(page);
    });

    test("Goals: Make it an idea and Delete pills under the title and chips; Delete asks, then Undo", async ({ page }) => {
      await home(page);
      const made = await pageDate(page, -5);
      await withRepo(
        page,
        { made },
        `await repo.createGoal({ title: "Finish the pretend short story", areaId: "writing", kind: "practice" }, args.made);
         await repo.createGoal({ title: "Learn a pretend song", areaId: "art", kind: "practice" }, args.made);`,
      );
      await page.goto("/goals");
      await page.getByRole("link", { name: "Finish the pretend short story" }).click();
      const panel = page.getByRole("complementary", { name: "Finish the pretend short story" });
      const pills = panel.locator(".goal-peek-actions");
      await expect(pills.getByRole("button")).toHaveText(["Make it an idea", "Delete"]);
      // Under the chips, above the bars.
      const chips = await panel.locator(".goal-peek-chips").boundingBox();
      const row = await pills.boundingBox();
      const bars = await panel.locator(".goal-peek-bars").boundingBox();
      expect(row!.y).toBeGreaterThan(chips!.y + chips!.height - 1);
      expect(row!.y + row!.height).toBeLessThan(bars!.y);
      const del = panel.getByRole("button", { name: "Delete goal" });
      await expect(del).toHaveCSS("background-color", "rgb(228, 207, 164)");
      await expect(del).toHaveCSS("padding", "6px 14px");
      await shoot(page, `4-goal-pills-${width}`);
      await noSideways(page);

      await del.click();
      await expect(panel.getByText("Delete this goal? You can restore it from the Bin.")).toBeVisible();
      await shoot(page, `4-goal-delete-ask-${width}`);
      await panel.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText("Moved to the Bin: Finish the pretend short story")).toBeVisible();
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(page.getByRole("link", { name: "Finish the pretend short story" })).toBeVisible();

      // Make it an idea: one tap; the idea opens; Undo brings the goal back.
      await page.getByRole("link", { name: "Learn a pretend song" }).click();
      await page.getByRole("complementary", { name: "Learn a pretend song" }).getByRole("button", { name: "Make it an idea" }).click();
      await expect(page.getByText("Changed to an idea; the goal is in the Bin")).toBeVisible();
      await page.getByRole("button", { name: "Undo" }).click();
      await page.goto("/goals");
      await expect(page.getByRole("link", { name: "Learn a pretend song" })).toBeVisible();
    });
  });
}
