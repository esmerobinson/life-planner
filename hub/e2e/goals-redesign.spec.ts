import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* The goals redesign (goals-redesign-brief.md; VISUAL-LANGUAGE.md "Goals redesign", "Home
   'Goals this month' column: C", "Goals can count themselves") in a real browser. All data is
   fictional. Set GOALS_SHOTS to a folder to also save screenshots at 1280px and 390px. */

type Row = Record<string, unknown>;
const SHOTS = process.env.GOALS_SHOTS;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

async function shoot(page: Page, name: string, fullPage = true) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
}

/** Raw rows into IndexedDB (a fresh context per test, so nothing real is touched). */
async function seed(page: Page, items: Row[], goals: Row[], journal: Row[] = []) {
  await page.evaluate(
    async ([is, gs, js]) => {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open("life-hub");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(["items", "goals", "journal"], "readwrite");
        for (const r of is) tx.objectStore("items").put(r);
        for (const g of gs) tx.objectStore("goals").put(g);
        for (const j of js) tx.objectStore("journal").put(j);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    },
    [items, goals, journal] as const,
  );
}

const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const t = y! * 12 + (m! - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const daysIn = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
};

/** A pretend world: the three goals set up as suggested, a book, a body goal, an inactive one. */
async function seedGoals(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const today = await pageDate(page, 0);
  const yesterday = await pageDate(page, -1);
  const month = today.slice(0, 7);
  const last = shift(month, -1);
  const task = (id: string, title: string, extra: Row = {}): Row => ({
    id, kind: "task", title, links: [], areaId: "mind", priority: 2, status: "open", createdAt: today, touchedAt: today, ...extra,
  });
  const items: Row[] = [
    task("t1", "Read a pretend article about emotion regulation", { goalId: "suggested-bpd-practice", status: "done", completedAt: today }),
    task("t2", "Pretend breathing practice", { status: "done", completedAt: yesterday }),
    task("t3", "Water the pretend fern", { areaId: "admin", due: today }),
    task("t4", "Outline the pretend chapter 4", { areaId: "writing", goalId: "g-book", milestone: true, status: "done", completedAt: last + "-10" }),
    task("t5", "Draft the pretend chapter 5", { areaId: "writing", goalId: "g-book", milestone: true }),
  ];
  const count = (id: string, m: string, title: string, target: number, extra: Row = {}): Row => ({ id, month: m, kind: "count", title, target, ...extra });
  const goals: Row[] = [
    {
      id: "suggested-bpd-practice", title: "BPD practice every day", areaId: "mind", kind: "practice", rhythm: "daily", onHome: true,
      countsFrom: ["exercise", "linked"], milestones: [], createdAt: today,
      monthGoals: [count("b1", last, "Days practised", daysIn(last)), count("b2", month, "Days practised", daysIn(month))],
    },
    {
      id: "suggested-journal-daily", title: "Journal daily", areaId: "mind", kind: "practice", rhythm: "daily", onHome: true,
      countsFrom: ["journal"], milestones: [], createdAt: today,
      monthGoals: [count("j1", month, "Days journalled", daysIn(month))],
    },
    {
      id: "suggested-mental-health", title: "Improve my mental health", areaId: "mind", kind: "practice",
      countsFrom: ["exercise", { area: "mind" }], milestones: [], createdAt: today,
      monthGoals: [
        count("h1", month, "Mind things done", 30),
        { id: "h2", month, kind: "step", title: "Book a pretend session about splitting" },
      ],
    },
    {
      id: "g-book", title: "Finish the pretend relationship book", areaId: "writing", kind: "finite", deadline: `${today.slice(0, 4)}-12-31`,
      onHome: true, milestones: [], createdAt: today,
      monthGoals: [
        count("w0", shift(month, -2), "Writing sessions", 20, { log: Array.from({ length: 20 }, () => `${shift(month, -2)}-03`) }),
        count("w1", last, "Writing sessions", 20, { log: Array.from({ length: 20 }, () => `${last}-05`) }),
        count("w2", month, "Writing sessions", 20, { log: [today, today] }),
        { id: "w3", month, kind: "step", title: "Send chapter 3 to a pretend friend", done: true },
        { id: "w4", month, kind: "step", title: "Finish the Part 2 draft" },
      ],
    },
    {
      id: "g-body", title: "Learn pretend calisthenics moves", areaId: "body", kind: "practice", milestones: [], createdAt: today,
      monthGoals: [count("c1", last, "Sessions", 12, { log: [`${last}-02`] }), { id: "c2", month: last, kind: "step", title: "First pretend push-up" }],
    },
    { id: "g-rest", title: "Pretend Spanish lessons (resting)", areaId: "mind", kind: "practice", active: false, milestones: [], createdAt: today },
  ];
  // Journal rows count by their clear kind and date; nothing in them is read here.
  const jrow = (id: string, kind: string, date: string): Row => ({ id, kind, date, fp: "0123456789abcdef", iv: "AAAAAAAAAAAAAAAA", ct: "AAAA" });
  const journal: Row[] = [jrow(`page:${yesterday}:p1`, "page", yesterday), jrow(`answer:${today}:a1`, "answer", today)];
  await seed(page, items, goals, journal);
  return { today, yesterday, month, last, monthName: MONTHS[Number(month.slice(5)) - 1]!, lastName: MONTHS[Number(last.slice(5)) - 1]! };
}

test.describe("desktop (1280px)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Suggested goals: nothing until a tap; each Add makes one; Dismiss hides the card", async ({ page }) => {
    await page.goto("/goals");
    const card = page.getByRole("region", { name: "Suggested goals" });
    await expect(card.getByText("Add your three goals")).toBeVisible();
    await expect(page.getByText("No goals yet.")).toBeVisible();
    await shoot(page, "suggested-goals-1280");
    await card.getByRole("button", { name: "Add BPD practice every day" }).click();
    await expect(page.getByRole("link", { name: "BPD practice every day" })).toBeVisible();
    await expect(card.getByText("Added")).toBeVisible();
    await card.getByRole("button", { name: "Add Journal daily" }).click();
    await expect(page.getByRole("link", { name: "Journal daily" })).toBeVisible();
    await card.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("region", { name: "Suggested goals" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("link", { name: "Journal daily" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Suggested goals" })).toHaveCount(0);
  });

  test("the Goals grid: Mind first, Active / Inactive, automatic counts, +1 / −1 and steps", async ({ page }) => {
    const { monthName, month, yesterday } = await seedGoals(page);
    await page.goto("/goals");
    // All three suggested goals are there, so the card is gone.
    await expect(page.getByRole("region", { name: "Suggested goals" })).toHaveCount(0);
    const areas = page.locator(".goals-area > h2");
    await expect(areas).toHaveText(["Mind", "Writing", "Body"]);
    // Tiles sit side by side in a grid.
    const mind = page.getByRole("list", { name: "Mind goals" }).getByRole("listitem").filter({ has: page.locator(".goal-band") });
    await expect(mind).toHaveCount(3);
    const boxes = await mind.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    expect(boxes[0]).toBe(boxes[1]);

    const bpd = page.locator(".goal-tile-a", { has: page.getByRole("link", { name: "BPD practice every day" }) });
    await expect(bpd).toHaveClass(/is-daily/);
    await expect(bpd.getByText("Daily", { exact: true })).toBeVisible();
    // Automatic counts: BPD from the linked to-do ticked today (the exercise cards are locked
    // here); Mind things done from both Mind to-dos; Journal daily from yesterday's page and
    // today's answer (yesterday only counts while it is this month).
    const both = yesterday.slice(0, 7) === month ? 2 : 1;
    await expect(bpd.getByText(`1 / ${daysIn(month)}`)).toBeVisible();
    await expect(bpd.getByText("Counts itself: today's exercise card, or a linked to-do")).toBeVisible();
    const health = page.locator(".goal-tile-a", { has: page.getByRole("link", { name: "Improve my mental health" }) });
    await expect(health.getByText(`${both} / 30`)).toBeVisible();
    await expect(health.getByText("Counts itself: exercises, Mind to-dos, Mind habits")).toBeVisible();
    const journal = page.locator(".goal-tile-a", { has: page.getByRole("link", { name: "Journal daily" }) });
    await expect(journal.getByText(`${both} / ${daysIn(month)}`)).toBeVisible();
    await expect(journal.getByTitle("2 days in a row")).toBeVisible();

    const book = page.locator(".goal-tile-a", { has: page.getByRole("link", { name: "Finish the pretend relationship book" }) });
    await expect(book.getByText(`${monthName} goals`)).toBeVisible();
    await expect(book.getByText("2 / 20")).toBeVisible();
    await expect(book.getByText("2 months in a row")).toBeVisible();
    await book.getByRole("button", { name: "+1 Writing sessions" }).click();
    await expect(book.getByText("3 / 20")).toBeVisible();
    await book.getByRole("button", { name: "Undo the last +1 on Writing sessions" }).click();
    await expect(book.getByText("2 / 20")).toBeVisible();
    await book.getByRole("button", { name: "+1 Writing sessions" }).click();
    await expect(book.getByText("3 / 20")).toBeVisible();
    await expect(book.getByText("1 of 3 done")).toBeVisible();
    await book.getByRole("checkbox", { name: "Finish the Part 2 draft" }).click();
    await expect(book.getByText("2 of 3 done")).toBeVisible();
    await shoot(page, "goals-grid-1280");
    await book.screenshot({ path: SHOTS ? `${SHOTS}/goal-tile-1280.png` : test.info().outputPath("tile.png") });

    await page.getByRole("button", { name: "Inactive" }).click();
    await expect(page.getByRole("link", { name: "Pretend Spanish lessons (resting)" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Finish the pretend relationship book" })).toHaveCount(0);
    await shoot(page, "goals-inactive-1280");
    await page.getByRole("button", { name: "Active", exact: true }).click();
    await expect(page.getByRole("link", { name: "Pretend Spanish lessons (resting)" })).toHaveCount(0);
  });

  test("Plan <Month> copies last month's counts; + Add makes a new one", async ({ page }) => {
    const { monthName } = await seedGoals(page);
    await page.goto("/goals");
    const body = page.locator(".goal-tile-a", { has: page.getByRole("link", { name: "Learn pretend calisthenics moves" }) });
    await body.getByRole("button", { name: `Plan ${monthName}` }).click();
    await expect(body.getByText("0 / 12")).toBeVisible();
    await expect(body.getByText("First pretend push-up")).toHaveCount(0); // steps aren't copied
    await expect(body.getByRole("button", { name: `Plan ${monthName}` })).toHaveCount(0);
    await body.getByRole("button", { name: new RegExp(`^\\+ Add an? ${monthName} goal$`) }).click();
    await body.getByRole("button", { name: "Step" }).click();
    await body.getByLabel("Title").fill("Hold a pretend plank");
    await body.getByRole("button", { name: "Add", exact: true }).click();
    await expect(body.getByRole("checkbox", { name: "Hold a pretend plank" })).toBeVisible();
  });

  test("the goal panel: streak, month dots, month goals, Past months, Active and Show on Home", async ({ page }) => {
    const { lastName } = await seedGoals(page);
    await page.goto("/goals?open=g-book");
    const panel = page.getByRole("complementary", { name: "Finish the pretend relationship book" });
    await expect(panel.getByRole("progressbar", { name: "Overall 1/2" })).toBeVisible();
    await expect(panel.getByText("2 / 20")).toBeVisible();
    const past = panel.getByRole("region", { name: "Past months" });
    await expect(past.getByRole("listitem").first()).toContainText(new RegExp(`^${lastName} \\d{4}Hit · 20 / 20$`));
    await expect(panel.getByRole("button", { name: "Active" })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("button", { name: "Show on Home" })).toHaveAttribute("aria-pressed", "true");
    await shoot(page, "goal-panel-1280");
    await page.goto("/goals?open=suggested-bpd-practice");
    const bpd = page.getByRole("complementary", { name: "BPD practice every day" });
    await expect(bpd.getByTitle("1 day in a row")).toBeVisible();
    await shoot(page, "goal-panel-daily-1280");
  });

  test("Home: mini colour-band cards beside Today, the BPD mint row on top of Today, the Choose goals pop-up", async ({ page }) => {
    await seedGoals(page);
    await page.goto("/");
    const column = page.getByRole("complementary", { name: "Goals this month" });
    await expect(column.locator(".goal-mini")).toHaveCount(3);
    await expect(column.locator(".goal-mini-link")).toHaveText(["BPD practice every day", "Journal daily", "Finish the pretend relationship book"]);
    await expect(column.getByText("2 / 20 this month")).toBeVisible();
    // ≥32px from Today.
    const gap = await page.evaluate(() => document.querySelector(".home-goals")!.getBoundingClientRect().left - document.querySelector(".home-centre")!.getBoundingClientRect().right);
    expect(gap).toBeGreaterThanOrEqual(32);

    const rows = page.getByRole("list", { name: "Daily goals" });
    await expect(rows.getByRole("button", { name: "BPD practice every day" })).toBeVisible();
    await expect(rows.getByRole("checkbox", { name: "BPD practice every day done today" })).toHaveAttribute("aria-checked", "true");
    await expect(rows.getByRole("checkbox", { name: "Journal daily done today" })).toHaveAttribute("aria-checked", "true");
    // Above the to-dos.
    const above = await page.evaluate(() => {
      const r = document.querySelector('[aria-label="Daily goals"]')!.getBoundingClientRect().bottom;
      const t = [...document.querySelectorAll(".today-panel .strip")].find((e) => e.textContent!.includes("Water the pretend fern"))!;
      return r <= t.getBoundingClientRect().top;
    });
    expect(above).toBe(true);
    await shoot(page, "home-1280");

    await column.getByRole("button", { name: "Choose goals" }).click();
    const sheet = page.getByRole("dialog", { name: "Goals on Home" });
    await expect(sheet.getByText("3 chosen")).toBeVisible();
    await expect(sheet.getByText("Pretend Spanish lessons (resting)")).toHaveCount(0);
    await expect(sheet).not.toContainText("On Home");
    await shoot(page, "choose-goals-1280", false);
    await sheet.getByRole("button", { name: "Improve my mental health" }).click();
    await expect(sheet.getByText("4 chosen")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Improve my mental health" })).toHaveAttribute("aria-pressed", "true");
    // Focus stays inside.
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(column.locator(".goal-mini")).toHaveCount(4);
    // A click on the dimmed page closes it too.
    await column.getByRole("button", { name: "Choose goals" }).click();
    await page.mouse.click(5, 5);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Tapping a card opens the goal.
    await column.locator(".goal-mini").first().click({ position: { x: 100, y: 50 } });
    await expect(page.getByRole("complementary", { name: "BPD practice every day" })).toBeVisible();
  });
});

test.describe("phone (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  async function noSideways(page: Page) {
    const m = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, i: window.innerWidth }));
    expect(m.w).toBeLessThanOrEqual(m.i);
  }

  test("the Goals grid is one column, the pop-up is a full-screen sheet; nothing scrolls sideways", async ({ page }) => {
    await page.goto("/goals");
    await shoot(page, "suggested-goals-390");
    await page.getByRole("region", { name: "Suggested goals" }).getByRole("button", { name: "Dismiss" }).click();
    await seedGoals(page);
    await page.goto("/goals");
    await expect(page.locator(".goal-tile-a").first()).toBeVisible();
    const lefts = await page.locator(".goal-tile-a").evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
    expect(lefts).toHaveLength(1);
    await noSideways(page);
    await shoot(page, "goals-grid-390");
    await page.getByRole("button", { name: "Inactive" }).click();
    await shoot(page, "goals-inactive-390");
    await page.getByRole("button", { name: "Active", exact: true }).click();

    await page.getByRole("button", { name: "Choose goals" }).click();
    const sheet = page.getByRole("dialog", { name: "Goals on Home" });
    const box = await sheet.boundingBox();
    expect(Math.round(box!.width)).toBe(390);
    expect(Math.round(box!.height)).toBe(844);
    await noSideways(page);
    await shoot(page, "choose-goals-390", false);
    await sheet.getByRole("button", { name: "Done" }).click();

    await page.goto("/goals?open=g-book");
    await expect(page.getByRole("complementary", { name: "Finish the pretend relationship book" })).toBeVisible();
    await noSideways(page);
    await shoot(page, "goal-panel-390");

    await page.goto("/");
    await expect(page.getByRole("list", { name: "Daily goals" })).toBeVisible();
    await noSideways(page);
    await shoot(page, "home-390");
  });
});
