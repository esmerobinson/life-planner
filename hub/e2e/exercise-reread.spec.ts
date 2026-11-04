import { expect, test, type Page } from "@playwright/test";
import { FAKE_CARD_TEXT_V2 } from "../src/test/exerciseCards";

/* Esme, 2026-11-04: "I submitted responses on todays exercise but cant see it in past exercises
   and it is not accurate to what i typed; i should be able to see this and easily reread what I
   wrote". In a real browser: type a long answer key by key, Submit straight after the last key,
   then reread it (Past exercises, See what you wrote, Read back, and after a reload), word for
   word. FICTIONAL cards and words; the sync address is a made-up one that never answers. */

const PASS = "fake-journal-e2e-passphrase";
const LONG =
  "Pretend afternoon by the made-up river. I noticed a small pretend worry, then a calmer pretend thought. " +
  "Second sentence, typed key by key, ending with the very last keys: pretend end";

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
    // The journal was set up on another device: its check row is here (an acceptance
    // recorded before the key is typed no longer confirms it, bug #4).
    const jkey = await at("/src/test/journalKey.ts");
    await db.journal.put(await jkey.verifierRow(await jkey.keyFor(pass)));
    await keys.unlockJournal(db, pass);
  }, PASS);
  await page.goto("/journal");
}

const section = (page: Page) => page.getByRole("region", { name: "Mental health exercise" });

test("type a long answer, Submit at once, and reread it word for word", async ({ page }) => {
  await unlocked(page);
  const s = section(page);
  await s.getByLabel("Exercise card file").setInputFiles({ name: "pretend-cards.json", mimeType: "application/json", buffer: Buffer.from(FAKE_CARD_TEXT_V2) });
  const today = s.getByRole("article", { name: "Today's card" });
  const box = today.getByLabel("Your response");
  await box.click();
  await box.pressSequentially(LONG, { delay: 2 });
  await today.getByRole("button", { name: "Submit" }).click(); // straight after the last key

  await expect(s.getByRole("article", { name: "Next card: Day 2" })).toBeVisible();

  // Past exercises lists today's answer, exactly.
  await s.getByText("Past exercises", { exact: true }).click();
  const past = s.getByRole("list", { name: "Past exercises" });
  await past.getByText(/ · Day 1 · Pretend weather$/).click(); // the date first, then the card
  await expect(past.locator(".journal-past-answer")).toHaveText(LONG);

  // See what you wrote: the card's own review.
  await s.getByRole("button", { name: "See what you wrote" }).click();
  await expect(s.getByRole("list", { name: "Your responses" }).locator(".journal-past-answer")).toHaveText(LONG);
  // journal-v3: the review is in the chapter map pop-up; close it before going on.
  await page.locator(".choose-top").getByRole("button", { name: "Done" }).click();

  // Read back, and again after a reload.
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    await page.getByRole("link", { name: /Read back/ }).click();
    const list = page.getByRole("list", { name: "Read back" });
    await list.getByText(/Exercise · Day 1 · Pretend weather/).click();
    await expect(list.locator(".journal-past-answer")).toHaveText(LONG);
    await expect(list.getByText("Not submitted")).toHaveCount(0);
    await expect(list.getByText(/Exercise · Day 1 · Pretend weather/)).toHaveCount(1); // no repeats
  }
});
