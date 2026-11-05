import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* Celebrations (VISUAL-LANGUAGE.md "Celebrations (2026-11-05)", option C, quick) in a real
   browser, on the Mac and the phone: every tick pops 5 stars from its tick box, then they are
   gone; the tick that leaves nothing unticked on Home's Today list gets 40 confetti pieces
   from the Today heading instead; with reduce motion nothing is drawn. All data is fictional. */

const WIDTHS = [
  { name: "Mac", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
];

async function seed(page: Page, areaId: string, titles: string[]) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const today = await pageDate(page, 0);
  await page.evaluate(
    async ({ today, areaId, titles }) => {
      const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
      const repo = await at("/src/data/repo.ts");
      for (const title of titles) await repo.createItem({ kind: "task", title, areaId, priority: 1, due: today }, today);
    },
    { today, areaId, titles },
  );
}

/** The centre of a box on screen, as the celebration takes it at click time. */
async function centre(page: Page, name: string) {
  const b = (await page.getByRole("checkbox", { name }).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Where the drawn pieces start (all of one burst start at one point). */
const startOf = (page: Page, sel: string) =>
  page.locator(sel).first().evaluate((el) => ({ x: parseFloat((el as HTMLElement).style.left), y: parseFloat((el as HTMLElement).style.top) }));

const stars = (page: Page) => page.locator(".celebration-layer .celebration-star");
const bits = (page: Page) => page.locator(".celebration-layer .celebration-bit");

for (const vp of WIDTHS) {
  test.describe(`at ${vp.width} (${vp.name})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("Home's Today: stars from the tick box, then confetti from Today for the last to-do", async ({ page }) => {
      await seed(page, "writing", ["Water the pretend fern", "Post the made-up letter"]);
      await page.goto("/");
      const first = "Mark done: Water the pretend fern";
      await expect(page.getByRole("checkbox", { name: first })).toBeVisible();
      const at = await centre(page, first);
      await page.getByRole("checkbox", { name: first }).click();
      await expect(stars(page)).toHaveCount(5);
      await expect(bits(page)).toHaveCount(0);
      await expect(page.getByTestId("celebration").first()).toHaveText("Done");
      const s = await startOf(page, ".celebration-star");
      expect(Math.abs(s.x - at.x)).toBeLessThan(1);
      expect(Math.abs(s.y - at.y)).toBeLessThan(1);
      const layer = await page.locator(".celebration-layer").evaluate((el) => {
        const c = getComputedStyle(el);
        return { position: c.position, pointerEvents: c.pointerEvents };
      });
      expect(layer).toEqual({ position: "fixed", pointerEvents: "none" });
      await expect(page.locator(".celebration-layer")).toHaveCount(0);

      // The last unticked to-do on Today: confetti from the heading, no stars.
      const heading = (await page.getByRole("heading", { name: "Today", exact: true }).boundingBox())!;
      await page.getByRole("checkbox", { name: "Mark done: Post the made-up letter" }).click();
      await expect(bits(page)).toHaveCount(40);
      await expect(stars(page)).toHaveCount(0);
      const c = await startOf(page, ".celebration-bit");
      expect(c.y).toBeGreaterThanOrEqual(heading.y);
      expect(c.y).toBeLessThanOrEqual(heading.y + heading.height);
      expect(c.x).toBeGreaterThanOrEqual(heading.x);
      await expect(page.locator(".celebration-layer")).toHaveCount(0);
      // Ticking behaved as before: both in the Done today dropdown.
      await expect(page.getByText("Done today (2)")).toBeVisible();
    });

    test("an area page: a tick pops stars (never confetti), then they are removed", async ({ page }) => {
      await seed(page, "art", ["Sketch a pretend teapot"]);
      await page.goto("/area/art");
      const name = "Mark done: Sketch a pretend teapot";
      await expect(page.getByRole("checkbox", { name })).toBeVisible();
      await page.getByRole("checkbox", { name }).click();
      await expect(stars(page)).toHaveCount(5);
      await expect(bits(page)).toHaveCount(0);
      await expect(page.locator(".celebration-layer")).toHaveCount(0);
    });

    test("reduce motion: the tick and its Done status, nothing drawn", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await seed(page, "writing", ["Fold the pretend laundry"]);
      await page.goto("/");
      const name = "Mark done: Fold the pretend laundry";
      await expect(page.getByRole("checkbox", { name })).toBeVisible();
      await page.evaluate(() => {
        const w = window as unknown as { drawn: boolean };
        w.drawn = false;
        new MutationObserver(() => {
          if (document.querySelector(".celebration-layer")) w.drawn = true;
        }).observe(document.body, { childList: true });
      });
      await page.getByRole("checkbox", { name }).click();
      await expect(page.getByText("Done today (1)")).toBeVisible();
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => (window as unknown as { drawn: boolean }).drawn)).toBe(false);
    });
  });
}
