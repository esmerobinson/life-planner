import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* Design round 2 in a real browser: strips, icons, due line, goal cards, month count and
   the done fold-out. All data is fictional. Set SHOTS_DIR to also save screenshots. */

type Row = Record<string, unknown>;

/** Raw rows into IndexedDB (a fresh context per test, so nothing real is touched). */
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

async function seedFictionalWorld(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const d = (n: number) => pageDate(page, n);
  const today = await d(0);
  const thisMonth = today.slice(0, 8);
  const [y, m] = today.split("-").map(Number);
  const lastMonth = m === 1 ? `${y - 1}-12-` : `${y}-${String(m - 1).padStart(2, "0")}-`;
  const task = (id: string, title: string, extra: Row = {}): Row => ({
    id, kind: "task", title, links: [], areaId: "art", priority: 3, status: "open",
    createdAt: today, touchedAt: today, ...extra,
  });
  const done = (id: string, title: string, completedAt: string, extra: Row = {}) =>
    task(id, title, { status: "done", completedAt, ...extra });
  const items: Row[] = [
    task("t1", "Sketch the pretend lighthouse for the zine cover", { due: await d(-2), priority: 1 }),
    task("t2", "Varnish the practice canvas", { pinnedDate: await d(1) }),
    task("t3", "Sort the imaginary paint drawer by colour family, then label every jar so it is easy to find later", { due: await d(4) }),
    task("t4", "Book the pretend life-drawing class", { due: today, goalId: "g1" }),
    { ...task("i1", "A comic about a snail who runs a post office"), kind: "idea", notes: "Maybe four panels" },
    done("d1", "Ink the fictional map", `${thisMonth}03`),
    done("d2", "Scan the pretend sketchbook", `${thisMonth}01`),
    done("d3", "Buy pretend brushes", `${lastMonth}20`),
    done("d4", "Clean the fictional palette", `${lastMonth}12`),
    done("d5", "Practise pretend hands", `${thisMonth}02`, { goalId: "g1" }),
    task("w1", "Draft the pretend essay opening", { areaId: "writing", goalId: "g2", pinnedDate: today }),
    task("b1", "Pretend stretch routine", { areaId: "body", priority: 1 }),
    task("x1", "Pretend loose thought to file", { areaId: "inbox", priority: 2 }),
    { ...task("x2", "Pretend idea to sort later", { areaId: "inbox", priority: 2 }), kind: "idea" },
  ];
  const goals: Row[] = [
    { id: "g1", title: "Draw every week (pretend)", areaId: "art", kind: "practice", monthlyTarget: 4, milestones: [], createdAt: today },
    {
      id: "g2", title: "Finish the pretend essay collection", areaId: "writing", kind: "finite", deadline: `${y}-12-31`,
      monthlyTarget: 6, createdAt: today,
      milestones: [
        { id: "m1", title: "Outline", done: true },
        { id: "m2", title: "First draft", done: false },
      ],
    },
    { id: "g3", title: "Pretend morning walks", areaId: "body", kind: "practice", milestones: [], createdAt: today },
  ];
  await seed(page, items, goals);
}

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

test("area page: strips, icons, due line, goal card, month count and the done fold-out", async ({ page }) => {
  await seedFictionalWorld(page);
  await page.goto("/area/art");
  await expect(page.getByText("3 ticked off in", { exact: false })).toBeVisible();
  await expect(page.getByText(/^last month 2$/)).toBeVisible();
  const late = page.getByText(/· 2 days late$/);
  await expect(late).toBeVisible();
  expect(await late.evaluate((e) => getComputedStyle(e).color)).toBe("rgb(191, 101, 100)");
  const strip = page.getByRole("list", { name: "To-dos" }).getByRole("listitem").first();
  expect(await strip.evaluate((e) => getComputedStyle(e).listStyleType)).toBe("none");
  expect(await strip.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(227, 221, 205)");
  await expect(page.getByRole("link", { name: "Draw every week (pretend)" })).toBeVisible();
  await expect(page.getByText("Done (5)", { exact: true })).toBeVisible();
  await shoot(page, "area-1280");

  // Schedule for: the popover opens under the icon, Escape closes it.
  await page.getByRole("button", { name: "Schedule for: Varnish the practice canvas" }).click();
  await expect(page.getByRole("group", { name: "Schedule Varnish the practice canvas for" })).toBeVisible();
  await shoot(page, "area-schedule-popover-1280");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Schedule Varnish the practice canvas for" })).toHaveCount(0);

  await page.getByText("Done (5)", { exact: true }).click();
  await shoot(page, "area-done-open-1280");
});

test("goals, today and inbox at desktop width", async ({ page }) => {
  await seedFictionalWorld(page);
  await page.goto("/goals");
  await expect(page.getByRole("heading", { level: 2, name: "Writing" })).toBeVisible();
  await expect(page.getByText("By 31 Dec")).toBeVisible();
  await shoot(page, "goals-1280");
  await page.goto("/today");
  await expect(page.getByText("Draft the pretend essay opening")).toBeVisible();
  await shoot(page, "today-1280");
  await page.goto("/inbox");
  await expect(page.getByText("Pretend loose thought to file")).toBeVisible();
  await shoot(page, "inbox-1280");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Finish the pretend essay collection" })).toBeVisible();
  await shoot(page, "home-1280");
});

test.describe("phone width (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /*
   * The app's sidebar is still a fixed 220px at every width (phone.spec.ts is fixme until
   * the phone design round with Esme), which leaves about 150px for the page, too little
   * for any strip. These checks therefore hide the sidebar to give the content the full
   * phone width that round will give it, and check the strips and cards themselves. The
   * screenshots are taken both ways ("-390" with the real sidebar, "-390-content" without).
   */
  async function contentAtFullWidth(page: Page) {
    await page.addStyleTag({ content: ".sidebar { display: none; }" });
  }

  /** Every strip and card keeps its contents inside it: titles wrap, icons stay on the right. */
  async function expectNothingSpills(page: Page) {
    const report = await page.evaluate(() => {
      const bad: string[] = [];
      if (document.documentElement.scrollWidth > window.innerWidth) bad.push("the page scrolls sideways");
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(".strip, .goal-card, .month-progress"))) {
        const what = el.textContent?.slice(0, 40);
        if (el.scrollWidth > el.clientWidth + 1) bad.push(`overflows: ${what}`);
        const box = el.getBoundingClientRect();
        if (box.right > window.innerWidth) bad.push(`past the screen edge: ${what}`);
        const title = el.querySelector<HTMLElement>(":scope > .strip-body .strip-title");
        if (title && title.getBoundingClientRect().width < box.width / 3) bad.push(`title squeezed: ${what}`);
        for (const icon of Array.from(el.querySelectorAll<HTMLElement>(":scope > .strip-actions button.icon"))) {
          const r = icon.getBoundingClientRect();
          if (r.right > box.right + 0.5 || r.left < box.left) bad.push(`icon outside: ${what}`);
          if (r.left < box.left + box.width / 2) bad.push(`icon not on the right: ${what}`);
        }
      }
      return bad;
    });
    expect(report).toEqual([]);
  }

  test("area page strips and cards do not spill at phone width", async ({ page }) => {
    await seedFictionalWorld(page);
    await page.goto("/area/art");
    await expect(page.getByText("3 ticked off in", { exact: false })).toBeVisible();
    await shoot(page, "area-390");
    await contentAtFullWidth(page);
    await expect(page.getByText(/· 2 days late$/)).toBeVisible();
    await shoot(page, "area-390-content");
    await expectNothingSpills(page);
  });

  test("goals, today and inbox at phone width", async ({ page }) => {
    await seedFictionalWorld(page);
    for (const [path, name, text] of [
      ["/goals", "goals-390", "By 31 Dec"],
      ["/today", "today-390", "Draft the pretend essay opening"],
      ["/inbox", "inbox-390", "Pretend loose thought to file"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByText(text).first()).toBeAttached();
      await shoot(page, name);
      await contentAtFullWidth(page);
      await expect(page.getByText(text).first()).toBeVisible();
      await shoot(page, `${name}-content`);
      await expectNothingSpills(page);
    }
  });
});
