import { expect, test, type Page } from "@playwright/test";
import { FAKE_CARD_FILE_CHECKLIST, FAKE_CARD_FILE_KINDS, FAKE_CARD_FILE_TRACKS, FAKE_CARD_TEXT_V2, PRETEND_FEATURES } from "../src/test/exerciseCards";

/* The Journal's "Mental health exercise" tab in a real browser (Journal v2): Import (a version 2
   card file), today's card with its chapter line and Read more, Submit, "Do the next one →", a
   card with parts, All cards with the optional Introduction first, and no sideways scroll on
   phones. The cards are a FICTIONAL fixture; the sync address is a made-up one that never
   answers. Set SHOTS_DIR to save screenshots. */

const PASS = "fake-journal-e2e-passphrase";

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

/** Sync set up for PASS and the journal unlocked (as the Sync page and Unlock would). */
async function unlocked(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  await page.evaluate(async (pass) => {
    const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
    const engine = await at("/src/sync/engine.ts");
    const token = await at("/src/sync/token.ts");
    const keys = await at("/src/journal/keyStore.ts");
    const { db } = await at("/src/data/db.ts");
    await engine.saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: await token.deriveToken(pass) });
    await db.syncMeta.put({ key: "acceptedToken", value: (await db.syncMeta.get("token")).value });
    await keys.unlockJournal(db, pass);
  }, PASS);
  await page.goto("/journal");
}

const section = (page: Page) => page.getByRole("region", { name: "Mental health exercise" });

async function importCards(page: Page) {
  await section(page).getByLabel("Exercise card file").setInputFiles({
    name: "pretend-cards.json",
    mimeType: "application/json",
    buffer: Buffer.from(FAKE_CARD_TEXT_V2),
  });
}

async function noSidewaysScroll(page: Page) {
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(m.s).toBeLessThanOrEqual(m.w);
}

async function walkThrough(page: Page, prefix: string) {
  await unlocked(page);
  await expect(page).toHaveURL(/\/journal\/exercise$/);
  const s = section(page);
  await expect(s.getByText("Add your exercise cards")).toBeVisible();
  await shoot(page, `${prefix}-empty`);

  await importCards(page);
  const today = s.getByRole("article", { name: "Today's card" });
  await expect(today.getByText("Pretend weather")).toBeVisible();
  await expect(today.getByText("Chapter 1 · Pretend basics")).toBeVisible();
  await expect(today.locator("em", { hasText: "pretend" })).toBeVisible();
  await expect(today.getByText("In your book: Pretend workbook, page 1")).toBeVisible();
  await today.getByText("Read more").click();
  const link = today.getByRole("link", { name: "Pretend Cloud Society: About clouds" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAttribute("target", "_blank");
  await shoot(page, `${prefix}-read-more`);

  await today.getByLabel("Your response").fill("Pretend: one small grey cloud, floating past the made-up hill.");
  await shoot(page, `${prefix}-before-submit`);
  await expect(today.getByRole("checkbox", { name: "Done" })).toHaveCount(0); // Submit is the only way
  await today.getByRole("button", { name: "Submit" }).click();

  // The card gives way, in place, to the next one (the kettle, a card with parts); one card on the page.
  const next = s.getByRole("article", { name: "Next card: Day 2" });
  await expect(next.getByText("The fictional kettle")).toBeVisible();
  await expect(s.getByRole("article")).toHaveCount(1);
  await expect(s.getByText(/Day 1 saved\. Here's the next one if you'd like to keep going\./)).toBeVisible();
  await expect(page.getByRole("link", { name: /Mental health exercise/ }).locator(".tick-auto.is-done")).toBeVisible();
  await shoot(page, `${prefix}-after-submit`);
  await expect(next.getByRole("button", { name: "Submit" })).toBeDisabled();
  await next.getByLabel("What does your pretend whistle sound like?").fill("Pretend: a small train");
  for (const [n, w] of [[1, "Pretend chest"], [2, "Pretend hands"]] as const) {
    await next.getByLabel(`Three pretend places you feel it, ${n}`).fill(w);
  }
  await expect(next.getByText("2 of 3 filled")).toBeVisible();
  await next.getByRole("group", { name: "How loud is it right now?" }).getByRole("button", { name: "6", exact: true }).click();
  await next.getByRole("group", { name: "Which pretend kettle is it?" }).getByRole("button", { name: "Tin" }).click();
  await next.getByText("See an example").click();
  await expect(next.getByText("Your book has its own example in Pretend workbook, page 2")).toBeVisible();
  await shoot(page, `${prefix}-next-one-parts`);
  await expect(next.getByRole("button", { name: "Submit" })).toBeDisabled();
  await next.getByLabel("Three pretend places you feel it, 3").fill("Pretend feet");
  await next.getByRole("button", { name: "Submit" }).click();
  await expect(s.getByRole("article", { name: "Next card: Day 3" })).toBeVisible(); // replaced again, in place
  await expect(s.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("link", { name: /Mental health exercise/ }).locator(".tick-auto.is-done")).toBeVisible();
  await noSidewaysScroll(page);

  await s.getByText("All cards", { exact: true }).click();
  await expect(s.getByText("Introduction (optional reading)")).toBeVisible();
  await s.getByText("Day 2 · The fictional kettle", { exact: true }).click(); // under All cards (Past exercises has it too, dated)
  await expect(s.getByRole("list", { name: "Your responses" }).getByText("6 out of 10")).toBeVisible();
  await shoot(page, `${prefix}-all-cards`);
  await noSidewaysScroll(page);

  // Stored sealed: no card or response text in clear.
  const rows = await page.evaluate(async () => {
    const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
    const { db } = await at("/src/data/db.ts");
    return JSON.stringify(await db.journal.toArray());
  });
  for (const word of ["Pretend", "pebble", "grey cloud", "small train", "example.org"]) expect(rows).not.toContain(word);

  // Reloaded: still today's card, done.
  await page.reload();
  await expect(section(page).getByText("Done for today · next card tomorrow")).toBeVisible();
  await expect(page.getByRole("link", { name: /Mental health exercise/ }).locator(".tick-auto.is-done")).toBeVisible();
}

test.describe("at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test("import, today's card, Read more, submit, do the next one (parts), all cards", async ({ page }) => {
    test.setTimeout(120_000);
    await walkThrough(page, "exercise-1280");
  });
});

test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("import, today's card, Read more, submit, do the next one (parts), all cards", async ({ page }) => {
    test.setTimeout(120_000);
    await walkThrough(page, "exercise-390");
  });
});

/** One card on its own (SHOTS_DIR). */
async function shootCard(card: ReturnType<Page["locator"]>, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await card.screenshot({ path: `${dir}/${name}.png` });
}

/** Imports a fixture file (through the Import pill, as she would). */
async function importFile(page: Page, text: string) {
  await section(page).getByLabel("Exercise card file", { exact: true }).setInputFiles({ name: "pretend.json", mimeType: "application/json", buffer: Buffer.from(text) });
}

for (const width of [1280, 390]) {
  test.describe(`at ${width}px (newer parts and two books)`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("a table (stacked rows on the phone), a scale, a tracker and a chain; two books taken in turn", async ({ page }) => {
      test.setTimeout(120_000);
      await unlocked(page);
      await importFile(page, JSON.stringify(FAKE_CARD_FILE_KINDS));
      const s = section(page);
      const today = s.getByRole("article", { name: "Today's card" });
      await expect(today.getByText("Pretend table", { exact: true })).toBeVisible();
      await expect(today.locator(".chip.exercise-format")).toHaveText("Table");
      const header = today.locator("thead");
      if (width < 700) await expect(header).toBeHidden(); // stacked row cards, the column names over each input
      else await expect(header).toBeVisible();
      await today.getByLabel("Feeling, row 1").fill("Pretend calm");
      await noSidewaysScroll(page);
      await shootCard(today, `card-${width}-table`);
      // The others, one after another.
      await today.getByRole("button", { name: "Do the next one →" }).click();
      const scale = s.getByRole("article", { name: "Next card: Day 2" });
      await scale.getByRole("group", { name: "How pretend-calm are you?" }).getByRole("button", { name: "4" }).click();
      await shootCard(scale, `card-${width}-scale`);
      await scale.getByRole("button", { name: "Do the next one →" }).click();
      const tracker = s.getByRole("article", { name: "Next card: Day 3" });
      await expect(tracker.getByText("Day 1 of 3")).toBeVisible();
      await tracker.getByLabel("Day 1, Hours").fill("7");
      await tracker.getByLabel("Day 1, Mood").fill("Pretend fine");
      await tracker.getByRole("button", { name: "Save today's entry" }).click();
      await expect(tracker.getByText("Saved")).toBeVisible();
      await shootCard(tracker, `card-${width}-tracker`);
      await tracker.getByRole("button", { name: "Do the next one →" }).click();
      const chain = s.getByRole("article", { name: "Next card: Day 4" });
      await expect(chain.locator(".exercise-chain-arrow")).toHaveCount(2);
      await chain.getByRole("textbox").first().fill("Pretend: the kettle was loud");
      await shootCard(chain, `card-${width}-chain`);
      await noSidewaysScroll(page);
      await shoot(page, `exercise-${width}-kinds`);

      // Two books: replace the cards, then the second book's card follows the first's.
      await s.getByText("All cards", { exact: true }).click();
      await importFile(page, JSON.stringify(FAKE_CARD_FILE_TRACKS));
      await s.getByRole("button", { name: "Replace" }).click();
      await expect(today.getByText("Pretend first workbook · Chapter 1 · Pretend chapter")).toBeVisible();
      await today.getByRole("button", { name: "Do the next one →" }).click();
      await expect(s.getByRole("article", { name: "Next card: Day 1" }).getByText("Pretend second workbook · Chapter 1 · Pretend chapter")).toBeVisible();
      await noSidewaysScroll(page);
      await shoot(page, `exercise-${width}-two-books`);
    });
  });
}

for (const width of [360, 390, 430]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });
    test("the exercise cards do not scroll sideways", async ({ page }) => {
      await unlocked(page);
      await expect(section(page).getByText("Add your exercise cards")).toBeVisible();
      await noSidewaysScroll(page);
      await importCards(page);
      const s = section(page);
      await expect(s.getByText("Pretend weather")).toBeVisible();
      await s.getByText("Read more").first().click();
      await noSidewaysScroll(page);
      await s.getByRole("button", { name: "Do the next one →" }).click();
      await expect(s.getByRole("group", { name: "How loud is it right now?" })).toBeVisible();
      await noSidewaysScroll(page);
      await s.getByText("All cards", { exact: true }).click();
      for (const name of ["Introduction (optional reading)", "Day 1 · Pretend weather", "Day 4 · A pretend lighthouse"]) {
        await s.getByText(name).click();
      }
      await expect(s.getByText(/doesn't chase the boats/)).toBeVisible();
      await noSidewaysScroll(page);
    });
  });
}

for (const width of [1280, 390]) {
  test.describe(`at ${width}px (scale without end labels)`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("a scale with no end labels still shows its numbers", async ({ page }) => {
      test.setTimeout(120_000);
      await unlocked(page);
      await importFile(page, JSON.stringify({ ...FAKE_CARD_FILE_CHECKLIST, cards: [{ ...FAKE_CARD_FILE_CHECKLIST.cards[2]!, day: 1 }] }));
      const today = section(page).getByRole("article", { name: "Today's card" });
      const group = today.getByRole("group", { name: "How pretend-calm are you?" });
      for (const n of ["1", "2", "3", "4", "5"]) await expect(group.getByRole("button", { name: n, exact: true })).toBeVisible();
      await group.getByRole("button", { name: "4", exact: true }).click();
      await noSidewaysScroll(page);
      await shootCard(today, `scale-bare-${width}`);
    });
  });
}

/* A checklist card: each item answered from the card's own options, with a note box; the label
   sits above the pills, nothing overflows at 390px (long labels and the widest options too). */
const WIDE_CHECKLIST = {
  ...FAKE_CARD_FILE_CHECKLIST,
  cards: [
    FAKE_CARD_FILE_CHECKLIST.cards[0]!,
    {
      ...FAKE_CARD_FILE_CHECKLIST.cards[1]!,
      id: "check-wide",
      day: 2,
      theme: "Pretend wide checklist",
      parts: [
        {
          prompt: "A pretend checklist with the longest words allowed",
          kind: "checklist",
          items: ["Pretend very long feature label ".repeat(3).slice(0, 80), "Pretendunbrokenfeaturelabel".repeat(3).slice(0, 80)],
          options: ["Pretend option one 1", "Pretend option two 2", "Pretend option 3 3", "Pretend option 4 44"],
          note: "A pretend note placeholder that is quite long, up to eighty characters in all..".slice(0, 80),
        },
      ],
    },
  ],
};

for (const width of [1280, 390]) {
  test.describe(`at ${width}px (checklist)`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("answers a checklist: pills, notes, the count line, Submit, read back", async ({ page }) => {
      test.setTimeout(120_000);
      await unlocked(page);
      await importFile(page, JSON.stringify(WIDE_CHECKLIST));
      const s = section(page);
      const today = s.getByRole("article", { name: "Today's card" });
      const prompt = "Go through the pretend features in your made-up book. Does each one fit you?";
      await expect(today.getByRole("group", { name: prompt })).toBeVisible();
      for (const f of PRETEND_FEATURES) await expect(today.getByText(f, { exact: true })).toBeVisible();
      await expect(today.getByText("0 of 4 answered")).toBeVisible();
      await expect(today.getByRole("button", { name: "Submit" })).toBeDisabled();

      // The label above its pills (and its note box under them), at every width.
      const label = await today.getByText("Pretend feature one", { exact: true }).boundingBox();
      const pillBox = await today.getByRole("group", { name: "Pretend feature one" }).boundingBox();
      const noteBox = await today.getByLabel("Pretend feature one, note").boundingBox();
      expect(label!.y + label!.height).toBeLessThanOrEqual(pillBox!.y + 1);
      expect(pillBox!.y + pillBox!.height).toBeLessThanOrEqual(noteBox!.y + 1);
      await noSidewaysScroll(page);
      await shootCard(today, `checklist-${width}-empty`);

      const pick = (item: string, option: string) => today.getByRole("group", { name: item }).getByRole("button", { name: option, exact: true }).click();
      await pick("Pretend feature one", "Yes");
      await pick("Pretend feature two", "Partly");
      await pick("Pretend feature three", "Yes");
      await today.getByLabel("Pretend feature two, note").fill("Pretend: only on weekdays");
      await expect(today.getByText("3 of 4 answered · Yes 2 · Partly 1")).toBeVisible();
      await expect(today.getByRole("button", { name: "Submit" })).toBeDisabled();
      await pick("Pretend feature three", "Yes"); // tap again: cleared
      await expect(today.getByText("2 of 4 answered · Yes 1 · Partly 1")).toBeVisible();
      await pick("Pretend feature three", "No");
      await pick("Pretend feature four", "Yes");
      await expect(today.getByText("4 of 4 answered · Yes 2 · Partly 1 · No 1")).toBeVisible();
      await shootCard(today, `checklist-${width}-answered`);
      await today.getByRole("button", { name: "Submit" }).click();
      await expect(s.getByRole("article", { name: "Next card: Day 2" })).toBeVisible(); // the next one takes its place

      // Reloaded: the answers come back; All cards shows each item with its choice and note.
      await page.reload();
      const again = section(page).getByRole("article", { name: "Today's card" });
      await expect(again.getByLabel("Pretend feature two, note")).toHaveValue("Pretend: only on weekdays");
      await expect(again.getByText("4 of 4 answered · Yes 2 · Partly 1 · No 1")).toBeVisible();
      await s.getByText("All cards", { exact: true }).click();
      await s.getByText("Day 1 · Pretend checklist", { exact: true }).click(); // under All cards
      const mine = s.getByRole("list", { name: "Your responses" });
      await expect(mine.getByText("Pretend feature two: Partly — Pretend: only on weekdays")).toBeVisible();
      await expect(mine.getByText("Pretend feature three: No", { exact: true })).toBeVisible();
      await noSidewaysScroll(page);
      await shoot(page, `checklist-${width}-review`);

      // The widest card: long labels, four 20-character options, a long note placeholder.
      await again.getByRole("button", { name: "Do the next one →" }).click();
      const wide = s.getByRole("article", { name: "Next card: Day 2" });
      await expect(wide.getByText("Pretend option one 1").first()).toBeVisible();
      await noSidewaysScroll(page);
      await shootCard(wide, `checklist-${width}-widest`);
    });
  });
}
