import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* The round Add button (1C) and project to-dos (2C, made with 3A) in a real browser, at
   computer and phone width. FICTIONAL data only. Set SHOTS_DIR to save screenshots. */

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/** Pretend to-dos and a project in Art; returns the project's id. */
async function seed(page: Page, opts: { plannedToday?: boolean } = {}) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const today = await pageDate(page);
  const made = await pageDate(page, -4);
  const due = await pageDate(page, 7);
  const done1 = await pageDate(page, -3);
  const done2 = await pageDate(page, -1);
  return page.evaluate(
    async ({ today, made, due, done1, done2, plannedToday }) => {
      const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
      const repo = await at("/src/data/repo.ts");
      const base = { kind: "task", areaId: "art", priority: 2 };
      await repo.createItem({ ...base, title: "Order a pretend A3 sketchbook", due }, made);
      const p = await repo.createItem(
        {
          ...base,
          title: "Pretend street scene",
          due,
          notes: "Low-poly street scene, all made up.",
          sessions: [
            { id: "s1", title: "Block out the street", doneOn: done1 },
            { id: "s2", doneOn: done2 },
            {
              id: "s3",
              title: "Lighting and papel picado",
              details: "Warm dusk light; strings of papel picado over the pretend stalls.",
              ...(plannedToday ? { plannedFor: today } : {}),
            },
            { id: "s4" },
          ],
        },
        made,
      );
      for (const t of ["Draw the pretend market reference", "Return the pretend colour book", "Scan the pretend sketches", "Tidy the pretend brushes", "Sort the pretend paper drawer"]) {
        await repo.createItem({ ...base, title: t, priority: 3 }, made);
      }
      return p.id as string;
    },
    { today, made, due, done1, done2, plannedToday: opts.plannedToday ?? false },
  );
}

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("the round + opens Add above it (or as a sheet), closes on Escape, and makes a project", async ({ page }) => {
      await page.goto("/area/art");
      await expect(page.getByRole("heading", { name: "Art", level: 1 })).toBeAttached();
      const add = page.getByRole("button", { name: "Add", exact: true });
      const box = (await add.boundingBox())!;
      expect(Math.round(box.width)).toBe(48);
      expect(Math.round(box.height)).toBe(48);
      expect(box.x + box.width).toBeGreaterThan(width - 30);
      await add.click();
      const dialog = page.getByRole("dialog", { name: "Add" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Title")).toBeFocused();
      await expect(dialog.getByLabel("Area")).toHaveValue("art");
      if (width < 700) {
        await expect(dialog).toHaveClass(/add-sheet/);
        const r = (await dialog.boundingBox())!;
        expect(Math.round(r.y + r.height)).toBe(800); // from the bottom
      } else {
        const r = (await dialog.boundingBox())!;
        expect(r.y + r.height).toBeLessThan(box.y); // just above the button
      }
      await noSideways(page);
      await shoot(page, `add-open-${width}`);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(add).toBeFocused();

      await add.click();
      await dialog.getByLabel("Type").selectOption("project");
      await expect(dialog.getByLabel("Sessions")).toHaveValue("4");
      await dialog.getByLabel("Title").fill("Pretend mural project");
      await dialog.getByLabel("Deadline").fill(await pageDate(page, 10));
      await shoot(page, `add-project-${width}`);
      await dialog.getByRole("button", { name: "Add item" }).click();
      await expect(dialog).toBeHidden();
      await expect(add).toBeFocused();
      const row = page.locator("li.project-row", { hasText: "Pretend mural project" });
      await expect(row).toBeVisible();
      await expect(row.getByRole("group", { name: "Sessions: Pretend mural project" }).getByRole("checkbox")).toHaveCount(4);
      await expect(row.getByText("Session 1 of 4")).toBeVisible();
    });

    test("an area page with a project: boxes, countdown edge, and the last row clears the +", async ({ page }) => {
      await seed(page);
      await page.goto("/area/art");
      const row = page.locator("li.project-row", { hasText: "Pretend street scene" });
      await expect(row.getByText("Next: Lighting and papel picado")).toBeVisible();
      await expect(row.getByText("Due", { exact: false })).toContainText("7 days left");
      const boxes = row.getByRole("group", { name: "Sessions: Pretend street scene" }).getByRole("checkbox");
      await expect(boxes).toHaveCount(4);
      const fill = row.locator(".project-edge-fill");
      const share = await fill.evaluate((el) => el.getBoundingClientRect().width / el.parentElement!.getBoundingClientRect().width);
      expect(share).toBeGreaterThan(0.5);
      expect(share).toBeLessThan(0.8);
      await noSideways(page);
      await row.scrollIntoViewIfNeeded();
      await shoot(page, `area-project-${width}`);

      // The main box logs the next session; the row stays and moves on to session 4.
      await row.getByRole("checkbox", { name: "Log a session: Pretend street scene" }).click();
      await expect(row.getByText("Session 4 of 4")).toBeVisible();

      // Scrolled to the bottom, the last thing on the page sits clear of the round button.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const fab = (await page.getByRole("button", { name: "Add", exact: true }).boundingBox())!;
      // Everything drawn in the page (the Done fold-out and Archive included), not the floating controls.
      const lastBottom = await page.evaluate(() => {
        const main = document.querySelector("main.app-content")!;
        const kids = [...main.querySelectorAll("*")].filter(
          (e) => !e.closest(".add-fab, .add-pop, .add-shade, .shell-undo, .peek, .farm-nook") && e.getBoundingClientRect().height > 0,
        );
        return Math.max(...kids.map((e) => e.getBoundingClientRect().bottom));
      });
      expect(lastBottom).toBeLessThanOrEqual(fab.y);
    });

    test("Today: Session 3 of 4 today · <title>, crossed out once ticked", async ({ page }) => {
      await seed(page, { plannedToday: true });
      await page.goto("/today");
      const row = page.getByRole("list", { name: "Today" }).locator("li", { hasText: "Pretend street scene" });
      await expect(row.getByText("Session 3 of 4 today · Lighting and papel picado")).toBeVisible();
      await noSideways(page);
      await shoot(page, `today-project-${width}`);
      await row.getByRole("checkbox", { name: "Log a session: Pretend street scene" }).click();
      await expect(row).toHaveClass(/crossed/);
      await expect(row.getByText("Session 3 of 4 done today · Lighting and papel picado")).toBeVisible();
      await shoot(page, `today-project-ticked-${width}`);
    });

    test("a goal changes to a project from its Edit, and Undo brings the goal back", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
      const deadline = await pageDate(page, 20);
      const id = await page.evaluate(async (deadline) => {
        const repo = await import(/* @vite-ignore */ "/src/data/repo.ts" as string);
        const today = (await import(/* @vite-ignore */ "/src/domain/dates.ts" as string)).todayISO();
        const g = await repo.createGoal(
          { title: "Pretend blender goal", areaId: "art", kind: "finite", deadline, monthlyTarget: 5, notes: "Pretend notes" },
          today,
        );
        return g.id as string;
      }, deadline);
      await page.goto(`/goals?open=${id}`);
      const goalPanel = page.getByRole("complementary", { name: "Pretend blender goal" });
      await goalPanel.getByRole("button", { name: "Edit" }).click();
      await goalPanel.getByLabel("Type").selectOption("project");
      await goalPanel.getByRole("button", { name: "Done" }).click();
      const projectPanel = page.getByRole("complementary", { name: "Pretend blender goal" });
      await expect(projectPanel.locator(".peek-kicker")).toHaveText("Project");
      await expect(projectPanel.getByRole("list", { name: "Sessions" }).getByRole("listitem")).toHaveCount(5);
      const undo = page.locator(".shell-undo");
      await expect(undo).toContainText("Changed to a project; the goal is in the Bin");
      await noSideways(page);
      await shoot(page, `goal-to-project-${width}`);
      await undo.getByRole("button", { name: "Undo" }).click();
      await expect(page.getByRole("complementary", { name: "Pretend blender goal" }).locator(".peek-kicker")).toHaveText("Goal");
    });

    test("the panel: summary, sessions with titles, details and days; add and name a session", async ({ page }) => {
      const id = await seed(page);
      await page.goto(`/area/art?open=${id}`);
      const panel = page.getByRole("complementary", { name: "Pretend street scene" });
      await expect(panel.getByText("2 of 4 sessions")).toBeVisible();
      const sessions = panel.getByRole("list", { name: "Sessions" });
      await expect(sessions.getByRole("listitem")).toHaveCount(4);
      await expect(sessions.getByLabel("Title of session 2")).toHaveAttribute("placeholder", "Session 2");
      await expect(sessions.getByLabel("Details of session 3")).toHaveValue(/Warm dusk light/);
      await noSideways(page);
      await shoot(page, `panel-project-${width}`);
      await panel.getByRole("button", { name: "+ Add a session" }).click();
      const t5 = sessions.getByLabel("Title of session 5");
      await expect(t5).toBeFocused();
      await t5.fill("Pretend final render");
      await t5.press("Enter");
      await expect.poll(async () =>
        page.evaluate(async (pid) => {
          const { db } = await import(/* @vite-ignore */ "/src/data/db.ts" as string);
          return (await db.items.get(pid)).sessions[4].title;
        }, id),
      ).toBe("Pretend final render");
    });
  });
}
