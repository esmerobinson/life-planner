import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* Round 3a in a real browser: the side panel (open, resize, remembered width), the goal
   view and its Edit mode, the Habits box, Today keeping crossed-off items, and the legacy
   milestone migration. All data is fictional. Set SHOTS_DIR to save screenshots. */

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
  const d = (n: number) => pageDate(page, n);
  const today = await d(0);
  const task = (id: string, title: string, extra: Row = {}): Row => ({
    id, kind: "task", title, links: [], areaId: "writing", priority: 2, status: "open",
    createdAt: today, touchedAt: today, ...extra,
  });
  const items: Row[] = [
    task("t1", "Ask about the pretend 1970s: where he lived, when he married", {
      due: await d(2), goalId: "g1", notes: "He mentioned a pretend flat. Check the imaginary letters box first.",
    }),
    task("t2", "Publish the pretend newsletter post", { due: await d(-2), pinnedDate: today }),
    task("t3", "Resolve the bracketed flags in pretend Part 1", { goalId: "g1", milestone: true }),
    task("t4", "Send pretend chapter 3 to a made-up friend", { goalId: "g1", status: "done", completedAt: today, pinnedDate: today }),
    task("t5", "Book a pretend writing day", { pinnedDate: today }),
    task("h1", "Write every day: one pretend story or one page", {
      recur: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], doneDates: [today],
    }),
    task("h2", "Pretend book session", { recur: ["mon", "tue", "wed", "thu", "fri", "sat"] }),
  ];
  const goals: Row[] = [
    {
      id: "g1", title: "Finish the pretend relationship book", areaId: "writing", kind: "finite",
      deadline: `${today.slice(0, 4)}-12-31`, monthlyTarget: 6, cadence: "6 sessions a month",
      why: "Because I want to help pretend people feel less alone in the messy middle.", createdAt: today,
      notes: "Part 2 plan\nStart with the story about the pretend train. Keep chapters short.",
      milestones: [
        { id: "m1", title: "Outline all pretend parts", done: true },
        { id: "m2", title: "Draft pretend Part 2", done: false },
      ],
    },
  ];
  await seed(page, items, goals);
}

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

test.describe("at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("a task opens in the side panel over the area; it resizes by its edge and remembers the width", async ({ page }) => {
    await seedWorld(page);
    await page.goto("/area/writing");
    await page.getByRole("button", { name: /^Ask about the pretend 1970s/ }).click();
    await expect(page).toHaveURL(/\?open=t1$/);
    const peek = page.locator(".peek");
    await expect(peek.getByLabel("Title")).toHaveValue(/^Ask about the pretend 1970s/);
    let box = (await peek.boundingBox())!;
    expect(Math.round(box.width)).toBe(460);
    expect(Math.round(box.x + box.width)).toBe(1280);
    // The list is still there behind it.
    await expect(page.getByRole("list", { name: "To-dos" })).toBeVisible();
    await shoot(page, "desktop-1280-area-task-panel");

    const handle = peek.getByRole("separator", { name: "Resize panel" });
    const h = (await handle.boundingBox())!;
    await page.mouse.move(h.x + 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 2 - 140, h.y + h.height / 2, { steps: 5 });
    await page.mouse.up();
    box = (await peek.boundingBox())!;
    expect(Math.round(box.width)).toBe(600);
    // Too far: clamped to 90% of the window.
    await page.mouse.move(box.x + 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(0, h.y + h.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(Math.round((await peek.boundingBox())!.width)).toBe(1152);

    await page.reload();
    await expect(page.locator(".peek")).toBeVisible();
    expect(Math.round((await page.locator(".peek").boundingBox())!.width)).toBe(1152);
    await page.keyboard.press("Escape");
    await expect(page.locator(".peek")).toHaveCount(0);
    await expect(page).toHaveURL(/\/area\/writing$/);
  });

  test("Back closes the panel", async ({ page }) => {
    await seedWorld(page);
    await page.goto("/area/writing");
    await page.getByRole("button", { name: /^Publish the pretend newsletter/ }).click();
    await expect(page.locator(".peek")).toBeVisible();
    await page.goBack();
    await expect(page.locator(".peek")).toHaveCount(0);
    await expect(page).toHaveURL(/\/area\/writing$/);
  });

  test("the goal view, its Edit mode, and the migrated milestones", async ({ page }) => {
    await seedWorld(page);
    await page.goto("/goals");
    await page.getByRole("link", { name: "Finish the pretend relationship book" }).click();
    const peek = page.locator(".peek");
    await expect(peek.getByRole("heading", { level: 2, name: "Finish the pretend relationship book" })).toBeVisible();
    // The legacy milestones became flagged tasks: 1 done of 3 flagged (2 migrated + t3).
    await expect(peek.getByText("Overall · milestones")).toBeVisible();
    await expect(peek.getByRole("progressbar", { name: "Overall 1/3" })).toBeVisible();
    await expect(peek.getByRole("list", { name: "To come" }).getByText("Draft pretend Part 2")).toBeVisible();
    await expect(peek.getByRole("list", { name: "Completed" }).getByText("Outline all pretend parts")).toBeVisible();
    await shoot(page, "desktop-1280-goal-panel-view");
    await peek.getByRole("button", { name: "Edit" }).click();
    await expect(peek.getByLabel("Why it matters")).toBeVisible();
    await shoot(page, "desktop-1280-goal-panel-edit");
    await peek.getByRole("button", { name: "Cancel" }).click();
  });

  test("Habits box with a ticked habit, and Today with crossed-off items", async ({ page }) => {
    await seedWorld(page);
    await page.goto("/area/writing");
    const box = page.getByRole("region", { name: "Habits" });
    await expect(box.getByText("Done for today")).toBeVisible();
    await expect(page.getByRole("list", { name: "To-dos" }).getByText("Pretend book session")).toHaveCount(0);
    await shoot(page, "desktop-1280-habits");
    await page.goto("/today");
    const list = page.getByRole("list", { name: "Today" });
    await list.getByRole("checkbox", { name: "Mark done: Book a pretend writing day" }).click();
    await expect(list.getByRole("checkbox", { name: "Done: Book a pretend writing day" })).toBeChecked();
    await expect
      .poll(async () => (await list.locator(".strip-title").allTextContents()).slice(-2).sort())
      .toEqual(["Book a pretend writing day", "Send pretend chapter 3 to a made-up friend"]);
    await shoot(page, "desktop-1280-today-crossed-off");
  });
});

test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  async function fits(page: Page) {
    const m = await page.evaluate(() => {
      const peek = document.querySelector<HTMLElement>(".peek-scroll");
      return {
        doc: document.documentElement.scrollWidth,
        peek: peek ? peek.scrollWidth - peek.clientWidth : 0,
        w: window.innerWidth,
      };
    });
    expect(m.doc).toBeLessThanOrEqual(m.w);
    expect(m.peek).toBeLessThanOrEqual(0);
  }

  test("panels, habits and Today fit the phone", async ({ page }) => {
    await seedWorld(page);
    await page.goto("/area/writing");
    await page.getByRole("button", { name: /^Ask about the pretend 1970s/ }).click();
    await expect(page.locator(".peek").getByLabel("Title")).toBeVisible();
    await fits(page);
    await shoot(page, "phone-390-area-task-panel");
    await page.locator(".peek").getByRole("button", { name: "Back" }).click();
    await expect(page.locator(".peek")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Habits" }).getByText("Done for today")).toBeVisible();
    await fits(page);
    await shoot(page, "phone-390-habits");

    await page.goto("/goals?open=g1");
    const peek = page.locator(".peek");
    await expect(peek.getByRole("heading", { level: 2 })).toBeVisible();
    await fits(page);
    await shoot(page, "phone-390-goal-panel-view");
    await peek.getByRole("button", { name: "Edit" }).click();
    await expect(peek.getByLabel("Why it matters")).toBeVisible();
    await fits(page);
    await shoot(page, "phone-390-goal-panel-edit");

    await page.goto("/today");
    await expect(page.getByRole("checkbox", { name: "Done: Send pretend chapter 3 to a made-up friend" })).toBeChecked();
    await fits(page);
    await shoot(page, "phone-390-today-crossed-off");
  });
});
