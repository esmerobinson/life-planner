import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* The 2026-11-02 round in a real browser: the Add form's Notes and its defaults from the
   page it opened on, compact strips (See more, hover look), and choosing the Home goals.
   All data is fictional. Set SHOTS_DIR to also save screenshots. */

type Row = Record<string, unknown>;

async function seed(page: Page, items: Row[], goals: Row[]) {
  await page.evaluate(
    async ([is, gs]) => {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open("life-hub");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(["items", "goals"], "readwrite");
        for (const r of is) tx.objectStore("items").put(r);
        for (const g of gs) tx.objectStore("goals").put(g);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    },
    [items, goals] as const,
  );
}

async function seedWorld(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const today = await pageDate(page, 0);
  const y = today.slice(0, 4);
  const task = (id: string, title: string, extra: Row = {}): Row => ({
    id, kind: "task", title, links: [], areaId: "content", priority: 2, status: "open",
    createdAt: today, touchedAt: today, ...extra,
  });
  await seed(
    page,
    [
      task("c1", "Film the pretend studio tour", { due: await pageDate(page, 3), notes: "Shots: desk, shelves, window" }),
      task("c2", "Edit the imaginary vlog intro", { due: await pageDate(page, -1) }),
      task("c3", "Reply to pretend comments", { pinnedDate: await pageDate(page, 1), tags: ["weekly"] }),
      task("c4", "Plan the fictional newsletter"),
      { ...task("c5", "A series about invented houseplants"), kind: "idea", notes: "Each episode one plant" },
    ],
    [
      { id: "g1", title: "Post twice a week (pretend)", areaId: "content", kind: "practice", monthlyTarget: 8, milestones: [], createdAt: today },
      { id: "g2", title: "Run a pretend 10k", areaId: "body", kind: "finite", deadline: `${y}-12-31`, milestones: [], createdAt: today },
      { id: "g3", title: "Learn pretend watercolour", areaId: "art", kind: "practice", monthlyTarget: 4, milestones: [], createdAt: today },
      { id: "g4", title: "Tidy the fictional files", areaId: "admin", kind: "practice", milestones: [], createdAt: today },
    ],
  );
}

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

async function sideways(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("compact strips: title and due line, See more, the hover look", async ({ page }) => {
      await seedWorld(page);
      await page.goto("/area/content");
      const todos = page.getByRole("list", { name: "To-dos" });
      await expect(todos.getByText("Film the pretend studio tour")).toBeVisible();
      await expect(page.getByText("Shots: desk, shelves, window")).toHaveCount(0);
      await expect(page.getByText("#weekly")).toHaveCount(0);
      await expect(page.getByText("Each episode one plant")).toHaveCount(0);
      await expect(todos.getByText(/· 1 day late$/)).toBeVisible();
      await expect(todos.getByRole("button", { name: "See more: Film the pretend studio tour" })).toBeVisible();
      await expect(todos.getByRole("button", { name: "See more: Plan the fictional newsletter" })).toHaveCount(0);
      const strip = todos.getByRole("listitem").filter({ hasText: "Plan the fictional newsletter" });
      expect(await strip.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(227, 221, 205)"); // --row
      await strip.getByText("Plan the fictional newsletter").hover();
      expect(await strip.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(212, 209, 195)"); // --track
      // The icon squares keep --panel, so they still stand out from the hovered strip.
      expect(await strip.locator("button.icon").first().evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
        "rgb(233, 227, 214)",
      );
      expect(await strip.evaluate((e) => getComputedStyle(e).cursor)).toBe("pointer");
      expect(
        await strip.locator(".strip-title").evaluate((e) => getComputedStyle(e).textDecorationLine),
      ).toBe("underline");
      expect(await sideways(page)).toBe(true);
      await shoot(page, `area-compact-hover-${width}`);

      await todos.getByRole("button", { name: "See more: Film the pretend studio tour" }).click();
      await expect(page.getByText("Shots: desk, shelves, window")).toBeVisible();
      await shoot(page, `area-see-more-panel-${width}`);
    });

    test("keyboard focus on a strip's title shows the same look", async ({ page }) => {
      await seedWorld(page);
      await page.goto("/area/content");
      const strip = page.getByRole("list", { name: "To-dos" }).getByRole("listitem").filter({ hasText: "Plan the fictional newsletter" });
      await strip.getByRole("button", { name: "Plan the fictional newsletter", exact: true }).focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      expect(await strip.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(212, 209, 195)");
    });

    test("Add from Content › To-dos opens there, with Notes; it saves into Content", async ({ page }) => {
      await seedWorld(page);
      await page.goto("/area/content");
      await page.getByRole("button", { name: "To-dos", exact: true }).click();
      await page.getByRole("button", { name: "Add", exact: true }).click();
      const form = page.locator("form.quick-add");
      await expect(form.getByLabel("Type")).toHaveValue("task");
      await expect(form.getByLabel("Area")).toHaveValue("content");
      await form.getByLabel("Title").fill("Storyboard the pretend trailer");
      await form.getByLabel("Notes").fill("Six frames\nend on the logo\nkeep it under a minute");
      const box = form.getByLabel("Notes");
      const h = await box.evaluate((e) => e.getBoundingClientRect().height);
      expect(await box.evaluate((e) => e.scrollHeight <= e.clientHeight + 1)).toBe(true); // grown, not scrolling
      expect(h).toBeGreaterThan(40);
      expect(await sideways(page)).toBe(true);
      await shoot(page, `add-from-content-todos-${width}`);
      await form.getByRole("button", { name: "Add item" }).click();
      const todos = page.getByRole("list", { name: "To-dos" });
      await expect(todos.getByText("Storyboard the pretend trailer")).toBeVisible();
      await expect(todos.getByRole("button", { name: "See more: Storyboard the pretend trailer" })).toBeVisible();
    });

    test("the goal panel's Show on Home toggle", async ({ page }) => {
      await seedWorld(page);
      await page.goto("/goals?open=g2");
      const toggle = page.getByRole("button", { name: "Show on Home" });
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      expect(await sideways(page)).toBe(true);
      await shoot(page, `goal-show-on-home-${width}`);
    });
  });
}

test.describe("Home goals at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Choose goals: tick which show on Home; they show in sidebar area order", async ({ page }) => {
    await seedWorld(page);
    await page.goto("/");
    const column = page.getByRole("complementary", { name: "Goals this month" });
    // Nothing chosen: the goals with a monthly target, as before.
    await expect(column.getByRole("link", { name: "Post twice a week (pretend)" })).toBeVisible();
    await expect(column.getByRole("link", { name: "Run a pretend 10k" })).toHaveCount(0);
    await column.getByRole("button", { name: "Choose goals" }).click();
    await column.getByRole("checkbox", { name: "Run a pretend 10k" }).check();
    await column.getByRole("checkbox", { name: "Tidy the fictional files" }).check();
    await column.getByRole("checkbox", { name: "Post twice a week (pretend)" }).check();
    await expect(column.getByRole("checkbox", { name: "Post twice a week (pretend)" })).toBeChecked();
    await shoot(page, "home-choose-goals-1280");
    await column.getByRole("button", { name: "Done" }).click();
    await expect(column.locator(".goal-title")).toHaveText([
      "Tidy the fictional files",
      "Post twice a week (pretend)",
      "Run a pretend 10k",
    ]);
    await expect(column.getByRole("link", { name: "Learn pretend watercolour" })).toHaveCount(0);
    expect(await sideways(page)).toBe(true);
    await shoot(page, "home-chosen-goals-1280");
  });
});
