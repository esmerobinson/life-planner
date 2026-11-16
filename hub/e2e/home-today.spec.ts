import { expect, test, type Page } from "@playwright/test";
import { FAKE_CARD_TEXT_V2 } from "../src/test/exerciseCards";
import { pageDate } from "./helpers";

/* Home is the Today page (Esme, 2026-11-04: "today page is a little redundant with the
   existence of home"): its list starts with the three Journal rows, mint, then the to-dos;
   the goals column's first card lines up with the first row. A lived-in FICTIONAL day: the
   journal unlocked with a week of pretend history, her two daily goals on Home, a Mind habit,
   to-dos for today (one already done). Set SHOTS_DIR to save screenshots. The sync address is
   a made-up one that never answers. */

const PASS = "fake-home-today-passphrase";

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

async function livedIn(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const days = await Promise.all([0, -1, -2, -3, -4, -30].map((o) => pageDate(page, o)));
  await page.evaluate(
    async ({ pass, cards, days }) => {
      const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
      const engine = await at("/src/sync/engine.ts");
      const token = await at("/src/sync/token.ts");
      const keys = await at("/src/journal/keyStore.ts");
      const repo = await at("/src/data/repo.ts");
      const exercise = await at("/src/journal/exercise.ts");
      const { db } = await at("/src/data/db.ts");
      await engine.saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: await token.deriveToken(pass) });
      // The journal was set up on another device: its check row is here (an acceptance
      // recorded before the key is typed no longer confirms it, bug #4).
      const jkey = await at("/src/test/journalKey.ts");
      await db.journal.put(await jkey.verifierRow(await jkey.keyFor(pass)));
      await keys.unlockJournal(db, pass);
      const jk = (await keys.loadJournalKey(db))!;
      const other = "e2e-pretend-other-device";
      const [today, d1, d2, d3, d4, old] = days;
      for (const d of [today, d1, d2, d3, d4]) await repo.finishMorningPage(jk, d, other, "Pretend page");
      for (const d of [d1, d2]) {
        await repo.ensureCheckinSet(jk, d, ["K2"]);
        await repo.saveAnswer(jk, d, "K2", other, "Pretend answer about a made-up river", true);
      }
      const set = exercise.parseCardFile(cards);
      await repo.importExerciseCards(jk, set, old);
      await repo.submitExerciseEntry(jk, d1, other, repo.cardRef(set.cards[1]), "Pretend: one small grey cloud.");
      // Her two daily goals (on Home), and a monthly one.
      await repo.addSuggestedGoal("suggested-bpd-practice", today);
      await repo.addSuggestedGoal("suggested-journal-daily", today);
      await repo.createGoal(
        { title: "Write pretend pages", areaId: "writing", kind: "practice", monthlyTarget: 12, onHome: true }, today,
      );
      const all = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
      await repo.createItem({ kind: "task", title: "Pretend breathing practice", areaId: "mind", priority: 2, recur: all, doneDates: [d1] }, today);
      for (const title of ["Water the pretend fern", "Post the made-up letter", "Draft the fictional essay opening"]) {
        await repo.createItem({ kind: "task", title, areaId: "writing", priority: 3, due: today }, today);
      }
      const done = await repo.createItem({ kind: "task", title: "Sweep the pretend porch", areaId: "admin", priority: 3, due: today }, today);
      await repo.tickItem(done.id, today);
    },
    { pass: PASS, cards: FAKE_CARD_TEXT_V2, days },
  );
  await page.reload();
  await expect(page.getByText("Water the pretend fern")).toBeVisible();
}

/** Where things sit on Home, in px (tops and bottoms of boxes; a heading's text baseline). */
async function measure(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null) => el!.getBoundingClientRect();
    /** The heading's first baseline: a zero-size inline-block sits on it. */
    const baseline = (h: Element) => {
      const probe = document.createElement("span");
      probe.style.cssText = "display:inline-block;width:0;height:0";
      h.append(probe);
      const y = probe.getBoundingClientRect().top;
      probe.remove();
      return y;
    };
    const panel = document.querySelector(".today-panel")!;
    const heading = panel.querySelector("h1, h2")!;
    const green = [...panel.querySelectorAll(".journal-rows > li")];
    const todos = [...panel.querySelectorAll('[aria-label="Rhythm"] > li, [aria-label="Today"] > li')];
    const goalsHeading = document.querySelector(".home-goals > h2");
    const cards = [...document.querySelectorAll(".home-goals .goal-mini")];
    const grid = document.querySelector(".phone-apps");
    const footer = document.querySelector(".phone-footer");
    const done = panel.querySelector("details.done-fold");
    return {
      headingBottom: box(heading).bottom,
      headingTop: box(heading).top,
      headingBaseline: baseline(heading),
      green: green.map((e) => ({ top: box(e).top, bottom: box(e).bottom })),
      todos: todos.map((e) => ({ top: box(e).top, bottom: box(e).bottom })),
      goalsHeadingBottom: goalsHeading ? box(goalsHeading).bottom : null,
      goalsHeadingTop: goalsHeading ? box(goalsHeading).top : null,
      goalsBaseline: goalsHeading ? baseline(goalsHeading) : null,
      cardTops: cards.map((e) => box(e).top),
      cardBottoms: cards.map((e) => box(e).bottom),
      gridBottom: grid ? box(grid).bottom : null,
      footerTop: footer ? box(footer).top : null,
      doneBottom: done ? box(done).bottom : null,
      sideways: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

const gaps = (list: { top: number; bottom: number }[]) => list.slice(1).map((b, i) => Math.round(b.top - list[i]!.bottom));

async function homeChecks(page: Page) {
  await expect(page.getByRole("list", { name: "Journal" }).locator("li.journal-row .strip-title")).toHaveText([
    "Mental health exercise", "Morning pages", "Daily check-in",
  ]);
  await expect(page.locator(".strip.journal-row .streak").first()).toBeVisible();
  // Her daily goals are not green rows; the to-done one is in "Done today (1)" under the list.
  await expect(page.locator(".today-panel .journal-row")).toHaveCount(3);
  await expect(page.locator("details.done-fold").filter({ hasText: "Done today (1)" })).toBeVisible();
}

for (const width of [1280, 1100, 1440]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("the green rows lead Today's list with clear space around them; the goals column lines up", async ({ page }) => {
      await livedIn(page);
      await homeChecks(page);
      await expect(page.getByRole("complementary", { name: "Goals this month" }).locator(".goal-mini")).toHaveCount(3);
      const m = await measure(page);
      // The Today heading to the first green row: --space-5 (24px).
      expect(Math.round(m.green[0]!.top - m.headingBottom)).toBe(24);
      // Rows in a group: --gap-rows (8px).
      expect(gaps(m.green)).toEqual([8, 8]);
      // The last green row to the first to-do: --gap-section (32px).
      expect(Math.round(m.todos[0]!.top - m.green[2]!.bottom)).toBe(32);
      // The two columns line up: headings on one baseline, the first goal card's top on the first row's.
      expect(Math.abs(m.goalsBaseline! - m.headingBaseline)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(m.cardTops[0]! - m.green[0]!.top)).toBeLessThanOrEqual(0.5);
      expect(gaps(m.cardTops.map((top, i) => ({ top, bottom: m.cardBottoms[i]! })))).toEqual([8, 8]);
      expect(m.sideways).toBe(false);
      if (width === 1280) await shoot(page, "home-1280");
    });
  });
}

test.describe("at 900px (goals below Today)", () => {
  test.use({ viewport: { width: 900, height: 900 } });
  test("the same gaps; the goals heading has the Today heading's space under it", async ({ page }) => {
    await livedIn(page);
    await homeChecks(page);
    const m = await measure(page);
    expect(Math.round(m.green[0]!.top - m.headingBottom)).toBe(24);
    expect(Math.round(m.todos[0]!.top - m.green[2]!.bottom)).toBe(32);
    expect(m.goalsHeadingTop!).toBeGreaterThan(m.todos[m.todos.length - 1]!.bottom);
    expect(Math.round(m.cardTops[0]! - m.goalsHeadingBottom!)).toBe(24);
    expect(m.sideways).toBe(false);
  });
});

test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("phone Home: the app grid, Today with the green rows first, the footer; spacing from the scale", async ({ page }) => {
    await livedIn(page);
    await homeChecks(page);
    const m = await measure(page);
    // A section heading: --gap-section (32px) above, --gap-stack (16px) under (as every h2).
    expect(Math.round(m.headingTop - m.gridBottom!)).toBe(32);
    expect(Math.round(m.green[0]!.top - m.headingBottom)).toBe(16);
    expect(gaps(m.green)).toEqual([8, 8]);
    expect(Math.round(m.todos[0]!.top - m.green[2]!.bottom)).toBe(32);
    // The footer links: a section gap under the list ("Done today" is last here).
    expect(Math.round(m.footerTop! - m.doneBottom!)).toBe(32);
    expect(m.sideways).toBe(false);
    await shoot(page, "home-390");
  });
});
