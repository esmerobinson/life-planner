import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* VISUAL-LANGUAGE.md "Full, no blank space (2026-11-05)" in a real browser, at 1280 and 390:
   goal cards share their area's row, Home's goal cards end where Today ends, short pages sit on
   a sheet reaching the bottom of the window, the Journal tabs are one row on the Mac and
   stacked on the phone, text boxes run the full width, and nothing scrolls sideways. All data
   is fictional. Set SHOTS_DIR to save screenshots. */

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

type Seed = { goals?: { title: string; areaId: string; onHome?: boolean }[]; tasks?: number; binned?: number };

/** Fictional goals, to-dos due today and binned to-dos, through the app's own repo (dev server). */
async function seed(page: Page, s: Seed) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const today = await pageDate(page, 0);
  await page.evaluate(
    async ({ s, today }) => {
      const at = (m: string): Promise<any> => import(/* @vite-ignore */ m); // the app's own module (dev server)
      const repo = await at("/src/data/repo.ts");
      for (const g of s.goals ?? []) await repo.createGoal({ ...g, kind: "practice", monthlyTarget: 10 }, today);
      for (let i = 0; i < (s.tasks ?? 0); i++) await repo.createItem({ kind: "task", title: `Pretend to-do ${i + 1}`, areaId: "admin", priority: 3, due: today }, today);
      for (let i = 0; i < (s.binned ?? 0); i++) {
        const it = await repo.createItem({ kind: "task", title: `Made-up binned errand ${i + 1}`, areaId: "admin", priority: 3 }, today);
        await repo.deleteItem(it.id, today);
      }
    },
    { s, today },
  );
}

async function noSidewaysScroll(page: Page) {
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(m.s).toBeLessThanOrEqual(m.w);
}

const rect = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });
    const phone = width < 700;

    test("Goals: an area's cards share its whole row (1 = full, 2 = halves, 3 = thirds, a 4th wraps and stretches)", async ({ page }) => {
      await seed(page, {
        goals: [
          { title: "Pretend solo art goal", areaId: "art" },
          { title: "Made-up writing goal one", areaId: "writing" },
          { title: "Made-up writing goal two", areaId: "writing" },
          ...["one", "two", "three", "four"].map((n) => ({ title: `Fictional body goal ${n}`, areaId: "body" })),
        ],
      });
      await page.goto("/goals");
      await expect(page.getByText("Fictional body goal four")).toBeVisible();
      const rows = async (label: string) =>
        page.getByRole("list", { name: `${label} goals` }).evaluate((ul) => {
          const g = ul.getBoundingClientRect();
          return [...ul.children].map((c) => {
            const b = c.getBoundingClientRect();
            return { left: b.left - g.left, right: g.right - b.right, w: b.width / g.width, top: Math.round(b.top) };
          });
        });
      const art = await rows("Art");
      expect(art).toHaveLength(1);
      expect(art[0].w).toBeGreaterThan(0.99);
      const writing = await rows("Writing");
      const body = await rows("Body");
      if (phone) {
        for (const c of [...writing, ...body]) expect(c.w).toBeGreaterThan(0.99); // one column
      } else {
        for (const c of writing) expect(c.w).toBeGreaterThan(0.48), expect(c.w).toBeLessThan(0.52);
        expect(writing[0].top).toBe(writing[1].top);
        expect(writing[1].right).toBeLessThan(1); // the row is filled to its right edge
        for (const c of body.slice(0, 3)) expect(c.w).toBeGreaterThan(0.31), expect(c.w).toBeLessThan(0.34);
        expect(new Set(body.slice(0, 3).map((c) => c.top)).size).toBe(1); // at most 3 across
        expect(body[3].w).toBeGreaterThan(0.99); // the wrapped 4th stretches
      }
      await noSidewaysScroll(page);
      await shoot(page, `nbs-goals-${width}`);
    });

    // The phone's Home has the app grid and Today, no goals column beside it: unchanged.
    if (!phone) test("Home: the goal cards share the column's height so it ends where Today ends", async ({ page }) => {
      await seed(page, {
        goals: [
          { title: "Pretend home goal one", areaId: "writing", onHome: true },
          { title: "Pretend home goal two", areaId: "art", onHome: true },
        ],
        tasks: 9,
      });
      await page.reload();
      const column = page.getByRole("complementary", { name: "Goals this month" });
      await expect(column.locator(".goal-mini")).toHaveCount(2);
      await expect(page.getByText("Pretend to-do 1", { exact: true })).toBeVisible();
      const m = await page.evaluate(() => {
        const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
        const cards = [...document.querySelectorAll(".goal-mini")].map((c) => c.getBoundingClientRect().height);
        return { today: r(".today-body").bottom, goals: r(".home-goals-body").bottom, list: r(".goal-mini-list").bottom, choose: r(".home-choose").bottom, cards };
      });
      expect(Math.abs(m.goals - m.today)).toBeLessThanOrEqual(2);
      expect(m.list).toBeLessThan(m.choose); // "Choose goals" stays under the cards
      expect(m.today - m.list).toBeLessThan(80); // the cards reach down to about Today's end
      expect(Math.abs(m.cards[0] - m.cards[1])).toBeLessThanOrEqual(2); // shared equally
      expect(m.cards[0]).toBeGreaterThan(120); // grown (a mini card is ~90px)
      await noSidewaysScroll(page);
      await shoot(page, `nbs-home-${width}`);
    });

    if (!phone) {
      test("Home: with a short Today the goal cards keep their own height", async ({ page }) => {
        await seed(page, { goals: ["one", "two", "three", "four"].map((n) => ({ title: `Pretend short-day goal ${n}`, areaId: "mind", onHome: true })) });
        await page.reload();
        const column = page.getByRole("complementary", { name: "Goals this month" });
        await expect(column.locator(".goal-mini")).toHaveCount(4);
        const grown = await page.evaluate(() => {
          const cards = [...document.querySelectorAll<HTMLElement>(".goal-mini")];
          const before = cards.map((c) => c.getBoundingClientRect().height);
          for (const c of cards) c.style.flexGrow = "0";
          const after = cards.map((c) => c.getBoundingClientRect().height);
          return before.map((h, i) => h - after[i]);
        });
        for (const g of grown) expect(Math.abs(g)).toBeLessThanOrEqual(1);
      });
    }

    for (const [path, name, ready] of [
      ["/bin", "Bin", "Made-up binned errand 1"],
      ["/sync", "Sync", "Sync address"],
      ["/backup", "Backup", "Download a backup"],
      ["/repeating", "Repeating", null],
      ["/reminders", "Reminders", null],
    ] as const) {
      test(`${name}: on a cream sheet reaching the bottom of the window`, async ({ page }) => {
        await seed(page, { binned: path === "/bin" ? 2 : 0 });
        await page.goto(path);
        if (ready) await expect(page.getByText(ready).first()).toBeVisible();
        await page.waitForTimeout(300);
        const sheet = page.locator(".page-sheet");
        await expect(sheet).toHaveCount(1);
        const s = await sheet.evaluate((el) => {
          const b = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          const doc = document.documentElement;
          return { bottom: b.bottom + scrollY, docBottom: doc.scrollHeight, vh: innerHeight, bg: st.backgroundColor, radius: st.borderTopLeftRadius, w: b.width, contentW: el.parentElement!.clientWidth };
        });
        expect(s.bg).toBe("rgb(233, 227, 214)"); // --panel
        expect(s.radius).toBe("18px"); // --radius-panel
        // At least down to the window's bottom gutter (24px; 16px on the phone), never short of it.
        expect(s.bottom).toBeGreaterThanOrEqual(s.vh - (phone ? 16 : 24) - 1);
        expect(s.docBottom - s.bottom).toBeLessThanOrEqual((phone ? 16 : 24) + 1);
        if (path === "/bin") {
          // A short page fits the window: no scrolling for empty space.
          expect(s.docBottom).toBeLessThanOrEqual(s.vh + 1);
          // Rows on the sheet stay --row.
          const row = await page.locator(".page-sheet .strip").first().evaluate((el) => getComputedStyle(el).backgroundColor);
          expect(row).toBe("rgb(227, 221, 205)");
        }
        await noSidewaysScroll(page);
        await shoot(page, `nbs-${path.slice(1)}-${width}`);
      });
    }

    test("Sort one by one: the card fills the width and reaches down to the bottom (it is the sheet)", async ({ page }) => {
      await seed(page, {});
      await page.evaluate(async () => {
        const at = (m: string): Promise<any> => import(/* @vite-ignore */ m);
        const repo = await at("/src/data/repo.ts");
        const d = new Date();
        const p = (n: number) => String(n).padStart(2, "0");
        const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        await repo.createItem({ kind: "task", title: "Pretend thing to sort", areaId: "inbox", priority: 2 }, today);
      });
      await page.goto("/inbox/sort");
      await expect(page.getByText("Pretend thing to sort")).toBeVisible();
      const m = await page.evaluate(() => {
        const card = document.querySelector(".sort-card")!.getBoundingClientRect();
        const content = document.querySelector(".app-content")!;
        const cs = getComputedStyle(content);
        const inner = content.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const count = document.querySelector(".sort-count")!.getBoundingClientRect();
        return { w: card.width, inner, bottom: card.bottom, count: count.top, vh: innerHeight, sheets: document.querySelectorAll(".page-sheet").length };
      });
      expect(m.w).toBeGreaterThanOrEqual(m.inner - 1);
      expect(m.sheets).toBe(0); // no second panel behind the card
      expect(m.count).toBeGreaterThan(m.bottom); // the count sits under it
      expect(m.bottom).toBeGreaterThan(m.vh - 120); // the card reaches down to just above the count and undo line
      await noSidewaysScroll(page);
    });

    test("Journal: the five tabs in one row of equal columns on the Mac, stacked rows on the phone", async ({ page }) => {
      await page.goto("/journal");
      const nav = page.getByRole("navigation", { name: "Journal parts" });
      await expect(nav.getByRole("link")).toHaveCount(5);
      const tabs = await nav.getByRole("link").evaluateAll((ls) => ls.map((l) => l.getBoundingClientRect().toJSON() as DOMRect));
      const box = await nav.evaluate((el) => ({ w: el.clientWidth, s: el.scrollWidth }));
      expect(box.s).toBeLessThanOrEqual(box.w);
      if (phone) {
        for (const t of tabs) expect(Math.round(t.width)).toBe(box.w);
        for (let i = 1; i < tabs.length; i++) expect(tabs[i].top).toBeGreaterThan(tabs[i - 1].top);
      } else {
        expect(new Set(tabs.map((t) => Math.round(t.top))).size).toBe(1);
        expect(new Set(tabs.map((t) => Math.round(t.width))).size).toBe(1);
        const total = tabs.reduce((a, t) => a + t.width, 0) + 8 * 4;
        expect(Math.abs(total - box.w)).toBeLessThanOrEqual(2); // they fill the width
        // Every label stays inside its tab (wrapping, never clipped or scrolled).
        const clipped = await nav.getByRole("link").evaluateAll((ls) => ls.filter((l) => l.scrollWidth > l.clientWidth).length);
        expect(clipped).toBe(0);
      }
      await noSidewaysScroll(page);
      await shoot(page, `nbs-journal-${width}`);
    });

    test("text boxes run the full width of their space; Add to inbox keeps its button beside it", async ({ page }) => {
      await page.goto("/inbox");
      const field = page.getByRole("textbox", { name: "Add to inbox" });
      await expect(field).toBeVisible();
      const inbox = await field.evaluate((input) => {
        const form = input.closest("form")!.getBoundingClientRect();
        const label = input.closest("label")!.getBoundingClientRect();
        const button = input.closest("form")!.querySelector("button")!.getBoundingClientRect();
        return { input: input.getBoundingClientRect().width, label: label.width, form: form.width, button: button.width, beside: Math.abs(button.bottom - input.getBoundingClientRect().bottom) < 4 };
      });
      expect(inbox.input).toBeGreaterThanOrEqual(0.9 * inbox.label);
      expect(inbox.input + inbox.button).toBeGreaterThanOrEqual(0.9 * inbox.form);
      expect(inbox.beside).toBe(true);
      await page.goto("/sync");
      await expect(page.getByText("Sync address")).toBeVisible();
      const ratios = await page.locator(".sync-page input[type=url], .sync-page input[type=password]").evaluateAll((is) =>
        is.map((i) => i.getBoundingClientRect().width / i.closest("form")!.getBoundingClientRect().width),
      );
      expect(ratios.length).toBeGreaterThanOrEqual(2);
      for (const r of ratios) expect(r).toBeGreaterThanOrEqual(0.9);
    });

    test("nothing scrolls sideways on any page", async ({ page }) => {
      for (const path of ["/", "/goals", "/inbox", "/inbox/sort", "/journal", "/journal/notes", "/bin", "/sync", "/backup", "/repeating", "/reminders", "/area/writing", "/vision"]) {
        await page.goto(path);
        await page.waitForTimeout(200);
        await noSidewaysScroll(page);
      }
    });
  });
}
