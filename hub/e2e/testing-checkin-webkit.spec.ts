import { expect, test, type Page } from "@playwright/test";

/* Testing session, 2026-11-05: Esme filled in the daily check-in in the Mac app (WebKit) in
   the morning; afterwards it said "Checked in for today" with no answers under it. This drives
   the same steps in WebKit (and Chrome for comparison) with a fresh profile, typing like a
   person (key by key, pauses to think). FICTIONAL words; the sync address never answers. */

const PASS = "fake-journal-e2e-passphrase";
const ENGINE = process.env.E2E_ENGINE === "chromium" ? "chromium" : "webkit";
test.use(ENGINE === "webkit" ? { browserName: "webkit", channel: "" } : {});

async function unlocked(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  await page.evaluate(async (pass) => {
    const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
    const engine = await at("/src/sync/engine.ts");
    const token = await at("/src/sync/token.ts");
    const keys = await at("/src/journal/keyStore.ts");
    const { db } = await at("/src/data/db.ts");
    await engine.saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: await token.deriveToken(pass) });
    await db.syncMeta.put({ key: "acceptedToken", value: (await db.syncMeta.get("token")).value });
    await keys.unlockJournal(db, pass);
  }, PASS);
  await page.goto("/journal/check-in");
}

const WORDS = ["Pretend first answer typed slowly", "Pretend second answer", "Pretend third answer, then Finish"];

for (const style of ["quick", "pause", "pause-then-click-away"] as const) {
  test(`${ENGINE}: check-in typed ${style}, Finish: every answer shows, and after a reload`, async ({ page }) => {
    await unlocked(page);
    const s = page.getByRole("region", { name: "Daily check-in" });
    for (let i = 0; i < 3; i++) {
      await expect(s.getByRole("img", { name: `Question ${i + 1} of 3` })).toBeVisible();
      const box = s.getByLabel("Your answer");
      await box.click();
      if (style === "quick") await box.fill(WORDS[i]!);
      else {
        await box.pressSequentially(WORDS[i]!, { delay: 40 });
        await page.waitForTimeout(1500); // she stops to think; the box autosaves
        if (style === "pause-then-click-away") await s.getByRole("img", { name: `Question ${i + 1} of 3` }).click();
      }
      await s.getByRole("button", { name: i === 2 ? "Finish" : "Next →" }).click();
    }
    await expect(s.getByText("Checked in for today")).toBeVisible();
    await expect(s.getByLabel("Your answer")).toHaveText(WORDS);
    await page.reload();
    const again = page.getByRole("region", { name: "Daily check-in" });
    await expect(again.getByText("Checked in for today")).toBeVisible();
    await expect(again.getByLabel("Your answer")).toHaveText(WORDS);
  });
}
