import { expect, test, type Locator, type Page } from "@playwright/test";
import { FAKE_CARD_TEXT_V2 } from "../src/test/exerciseCards";
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

const PASS = "fake-app-queue-passphrase";
const HL_WORDS = "clouds over a made-up hill";
const HL_NOTE = "Pretend note: remember this on a grey pretend day.";
const exerciseTab = (page: Page) => page.getByRole("region", { name: "Mental health exercise" });

/** The journal unlocked (set up on another pretend device; the sync address never answers), then `path`. */
async function unlocked(page: Page, path: string) {
  await home(page);
  await page.evaluate(async (pass) => {
    const at = (p: string): Promise<any> => import(/* @vite-ignore */ p); // the app's own module (dev server)
    const engine = await at("/src/sync/engine.ts");
    const token = await at("/src/sync/token.ts");
    const keys = await at("/src/journal/keyStore.ts");
    const { db } = await at("/src/data/db.ts");
    await engine.saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: await token.deriveToken(pass) });
    const jkey = await at("/src/test/journalKey.ts");
    await db.journal.put(await jkey.verifierRow(await jkey.keyFor(pass)));
    await keys.unlockJournal(db, pass);
  }, PASS);
  await page.goto(path);
}

/** Selects words the way a person does: press, drag across them, let go. */
async function dragSelect(page: Page, within: Locator, words: string) {
  await within.scrollIntoViewIfNeeded();
  const box = await within.evaluate((el, w) => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const i = (n as Text).data.indexOf(w);
      if (i < 0) continue;
      const at = (k: number) => {
        const r = document.createRange();
        r.setStart(n!, k);
        r.setEnd(n!, k + 1);
        return r.getBoundingClientRect();
      };
      const a = at(i);
      const b = at(i + w.length - 1);
      return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2, bottom: b.bottom };
    }
    return null;
  }, words);
  if (!box) throw new Error(`"${words}" isn't on the page`);
  await page.mouse.move(box.x1, box.y1);
  await page.mouse.down();
  await page.mouse.move(box.x2, box.y2, { steps: 12 });
  await page.mouse.up();
  return box;
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

    test("Highlights: yellow, the pill just under the words, a note mark after noted words, and the fifth Read back tile", async ({ page }) => {
      test.setTimeout(150_000);
      await unlocked(page, "/journal/exercise");
      await exerciseTab(page).getByLabel("Exercise card file").setInputFiles({
        name: "pretend-cards.json", mimeType: "application/json", buffer: Buffer.from(FAKE_CARD_TEXT_V2),
      });
      const card = exerciseTab(page).getByRole("article", { name: "Today's card" });
      await expect(card.getByText("Pretend weather")).toBeVisible();
      const learn = card.locator('[data-hl-field="learn"]');

      // The pill pops up just under the selected words, in the app's green.
      const words = await dragSelect(page, learn, HL_WORDS);
      const pill = page.getByRole("button", { name: "Highlight", exact: true });
      await expect(pill).toBeVisible();
      await expect(pill).toHaveCSS("background-color", "rgb(152, 194, 147)");
      const pb = (await pill.boundingBox())!;
      expect(pb.y).toBeGreaterThanOrEqual(words.bottom);
      expect(pb.y).toBeLessThan(words.bottom + 12);
      await shoot(page, `5-highlight-pill-${width}`);
      await pill.click();

      // Nook Shopping yellow; no note yet, so no note mark.
      const mark = learn.locator("mark.hl-mark");
      await expect(mark).toHaveText(HL_WORDS);
      await expect(mark).toHaveCSS("background-color", "rgb(232, 221, 110)");
      await expect(learn.locator(".hl-notemark")).toHaveCount(0);

      // Add a note: the note mark shows after the words; tapping it reads the note.
      await mark.click();
      const sheet = page.getByRole("dialog", { name: "Highlight" });
      await sheet.getByLabel("Note (optional)").fill(HL_NOTE);
      await sheet.locator(".choose-top").getByRole("button", { name: "Done" }).click();
      await expect(sheet).toHaveCount(0);
      const note = learn.getByRole("button", { name: `Read the note on: ${HL_WORDS}` });
      await expect(note).toBeVisible();
      await expect(note).toHaveCSS("width", "20px");
      await expect(note).toHaveCSS("background-color", "rgb(228, 207, 164)");
      const mb = (await mark.boundingBox())!;
      const nb = (await note.boundingBox())!;
      expect(nb.x).toBeGreaterThanOrEqual(mb.x + mb.width - 1); // after the words
      await expect(learn).toHaveText("A made-up note: feelings drift past like pretend clouds over a made-up hill.");
      await shoot(page, `5-highlight-note-mark-${width}`);
      await page.reload();
      const again = exerciseTab(page).getByRole("article", { name: "Today's card" }).getByRole("button", { name: `Read the note on: ${HL_WORDS}` });
      await again.click();
      await expect(page.getByRole("dialog", { name: "Highlight" }).getByLabel("Note (optional)")).toHaveValue(HL_NOTE);
      await shoot(page, `5-highlight-note-open-${width}`);
      await page.getByRole("dialog", { name: "Highlight" }).locator(".choose-top").getByRole("button", { name: "Done" }).click();

      // Read back: five tiles; one row on the Mac; Highlights full width at the bottom on the phone.
      await page.goto("/journal/read-back");
      const tiles = page.locator("button.journal-readback-tile");
      await expect(tiles).toHaveCount(5);
      const hl = tiles.nth(4);
      await expect(hl).toHaveText(/^Highlights1Last: /);
      await expect(hl).toHaveCSS("background-color", await tiles.nth(0).evaluate((e) => getComputedStyle(e).backgroundColor));
      await expect(hl).toHaveCSS("outline-style", "none");
      const boxes = await tiles.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
      const grid = (await page.locator(".journal-readback-tiles").boundingBox())!;
      if (phone) {
        expect(boxes[4].top).toBeGreaterThan(boxes[3].bottom - 1);
        expect(Math.abs(boxes[4].width - grid.width)).toBeLessThan(1);
      } else {
        for (const b of boxes) expect(Math.abs(b.top - boxes[0].top)).toBeLessThan(1);
      }
      await shoot(page, `5-readback-tiles-${width}`);
      await noSideways(page);
    });

    test("Home: the second fold-out reads Coming up (N)", async ({ page }) => {
      await home(page);
      const soon = await pageDate(page, 1);
      const later = await pageDate(page, 2);
      await withRepo(
        page,
        { soon, later, today: await pageDate(page, 0) },
        `const t = { kind: "task", priority: 2, areaId: "admin" };
         for (const [i, title] of ["Post the pretend parcel", "Book a made-up haircut", "Return the pretend library book", "Water the made-up ferns"].entries())
           await repo.createItem({ ...t, title, due: args.soon }, args.today);
         for (const title of ["Phone the pretend dentist", "Pay the made-up bill", "Send the pretend card"])
           await repo.createItem({ ...t, title, due: args.later }, args.today);`,
      );
      await page.reload();
      const summary = page.locator("summary", { hasText: /^Coming up/ });
      await expect(summary).toHaveText("Coming up (3)");
      await expect(page.getByText("Also due")).toHaveCount(0);
      await expect(page.getByText("Due in the next few days")).toHaveCount(0);
      await summary.click();
      await expect(page.getByRole("list", { name: "Coming up" }).getByRole("listitem")).toHaveCount(3);
      await page.getByRole("list", { name: "Coming up" }).scrollIntoViewIfNeeded();
      await shoot(page, `6-coming-up-${width}`);
    });
  });
}
