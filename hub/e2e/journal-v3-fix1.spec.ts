import { expect, test, type Page } from "@playwright/test";
import { FAKE_CARD_TEXT_BOOKS } from "../src/test/exerciseCards";

/* Journal v3, fix round 1, in a real browser: the finished check-in (answers read-only, Edit),
   the same week bars on the three parts at 0, Edit on today's exercise answer (the earlier
   version kept), a note in progress kept across a reload, and an older unfinished morning page
   offered back. FICTIONAL words only; the sync address is a made-up one that never answers. Set
   SHOTS_DIR to save screenshots. */

const PASS = "fake-journal-e2e-passphrase";

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

async function unlocked(page: Page, path = "/journal") {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  await page.evaluate(async (pass) => {
    const at = (p: string): Promise<any> => import(/* @vite-ignore */ p); // the app's own module (dev server)
    const engine = await at("/src/sync/engine.ts");
    const token = await at("/src/sync/token.ts");
    const keys = await at("/src/journal/keyStore.ts");
    const { db } = await at("/src/data/db.ts");
    await engine.saveSyncSettings(db, { serverUrl: "https://sync.example.test", token: await token.deriveToken(pass) });
    await db.syncMeta.put({ key: "acceptedToken", value: (await db.syncMeta.get("token")).value });
    await keys.unlockJournal(db, pass);
  }, PASS);
  await page.goto(path);
}

async function noSidewaysScroll(page: Page) {
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(m.s).toBeLessThanOrEqual(m.w);
}

const tabsNav = (page: Page) => page.getByRole("navigation", { name: "Journal parts" });

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("week bars on all three parts at 0, lined up; Home's rows too", async ({ page }) => {
      await unlocked(page);
      const nav = tabsNav(page);
      for (const name of [/Mental health exercise/, /Morning pages/, /Daily check-in/]) {
        const link = nav.getByRole("link", { name });
        await expect(link.locator(".streak .streak-day")).toHaveCount(7);
        await expect(link.locator(".streak-day.on")).toHaveCount(0);
        await expect(link.locator(".streak-n")).toHaveText("0");
      }
      if (width === 390) {
        // Stacked: the three week bars line up.
        const xs = await nav.locator(".streak").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
        expect(new Set(xs).size).toBe(1);
      }
      await noSidewaysScroll(page);
      await shoot(page, `fix1-week-bars-tabs-${width}`);
      await page.goto("/");
      const rows = page.getByRole("list", { name: "Journal" });
      await expect(rows.locator(".streak")).toHaveCount(3);
      await noSidewaysScroll(page);
      await shoot(page, `fix1-week-bars-home-${width}`);
      await page.goto("/area/mind");
      await expect(page.getByRole("list", { name: "Habits" }).locator(".journal-row .streak")).toHaveCount(3);
      await noSidewaysScroll(page);
      await shoot(page, `fix1-week-bars-mind-${width}`);
    });

    test("a finished check-in: her answers read-only, Edit, Save", async ({ page }) => {
      await unlocked(page, "/journal/check-in");
      const s = page.getByRole("region", { name: "Daily check-in" });
      const words = ["Pretend: the rain on a made-up window", "Pretend: I asked for help", "Pretend: a warm bath"];
      for (let i = 0; i < 3; i++) {
        await expect(s.getByRole("img", { name: `Question ${i + 1} of 3` })).toBeVisible();
        await s.getByLabel("Your answer").fill(words[i]!);
        await s.getByRole("button", { name: i === 2 ? "Finish" : "Next →" }).click();
      }
      await expect(s.getByText("Checked in for today")).toBeVisible();
      await expect(s.locator(".journal-answers output")).toHaveText(words);
      await expect(s.getByRole("textbox")).toHaveCount(0);
      await noSidewaysScroll(page);
      await shoot(page, `fix1-checkin-finished-${width}`);
      await s.getByRole("button", { name: "Edit" }).click();
      await expect(s.getByRole("textbox", { name: "Your answer" })).toHaveCount(3);
      await shoot(page, `fix1-checkin-editing-${width}`);
      await s.getByRole("textbox", { name: "Your answer" }).nth(1).fill("Pretend: I asked for help, and it went fine");
      await s.getByRole("button", { name: "Save" }).click();
      await expect(s.locator(".journal-answers output").nth(1)).toHaveText("Pretend: I asked for help, and it went fine");
      // The save has landed (sealed in the store) before the reload.
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
            const repo = await at("/src/data/repo.ts");
            const keys = await at("/src/journal/keyStore.ts");
            const dates = await at("/src/domain/dates.ts");
            const { db } = await at("/src/data/db.ts");
            const day = await repo.readCheckinDay(await keys.loadJournalKey(db), dates.todayISO());
            return [...day.answers.values()].map((a: { answer: string | null }) => a.answer);
          }),
        )
        .toContain("Pretend: I asked for help, and it went fine");
      await page.reload();
      await expect(page.getByRole("region", { name: "Daily check-in" }).locator(".journal-answers output").nth(1)).toHaveText(
        "Pretend: I asked for help, and it went fine",
      );
    });

    test("Edit on today's exercise answer keeps the earlier version", async ({ page }) => {
      await unlocked(page);
      const s = page.getByRole("region", { name: "Mental health exercise" });
      await s.getByLabel("Exercise card file").setInputFiles({ name: "pretend-cards.json", mimeType: "application/json", buffer: Buffer.from(FAKE_CARD_TEXT_BOOKS) });
      const today = s.getByRole("article", { name: "Today's card" });
      await today.getByLabel("Your response").fill("Pretend: a first answer");
      await today.getByRole("button", { name: "Submit" }).click();
      await s.getByRole("button", { name: "See what you wrote" }).click();
      const map = page.getByRole("dialog", { name: "Your workbooks" });
      const mine = map.getByRole("list", { name: "Your responses" });
      await mine.getByRole("button", { name: "Edit" }).click();
      await mine.getByLabel("Your response").fill("Pretend: a first answer, and a second thought");
      await mine.getByRole("button", { name: "Save" }).click();
      await expect(mine.getByText(/^Earlier version · /)).toBeVisible();
      await expect(mine.getByText("Pretend: a first answer", { exact: true })).toBeVisible();
      await expect(mine.getByText("Pretend: a first answer, and a second thought", { exact: true })).toBeVisible();
      await noSidewaysScroll(page);
      await shoot(page, `fix1-exercise-edit-${width}`);
    });

    test("a note in progress comes back after a reload", async ({ page }) => {
      await unlocked(page, "/journal/notes");
      const s = page.getByRole("region", { name: "Notes to myself" });
      await s.getByRole("button", { name: "+ Write your answer: I'm too much" }).click();
      await s.getByRole("textbox", { name: "What I know when I'm steady…" }).fill("Pretend: people stayed");
      await page.waitForTimeout(1200); // autosaved
      await page.reload();
      const form = page.getByRole("region", { name: "Notes to myself" }).getByRole("form", { name: "Your note" });
      await expect(form.getByRole("textbox", { name: "What I know when I'm steady…" })).toHaveValue("Pretend: people stayed");
      await noSidewaysScroll(page);
      await shoot(page, `fix1-note-draft-back-${width}`);
    });

    test("a note written on two devices without seeing each other: the newest, the other below", async ({ page }) => {
      await unlocked(page, "/journal/notes");
      await expect(page.getByRole("region", { name: "Notes to myself" })).toBeVisible();
      await page.evaluate(async () => {
        const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
        const repo = await at("/src/data/repo.ts");
        const keys = await at("/src/journal/keyStore.ts");
        const dates = await at("/src/domain/dates.ts");
        const { db } = await at("/src/data/db.ts");
        const jk = await keys.loadJournalKey(db);
        const today = dates.todayISO();
        const note = { prompt: "He's going to leave", thought: "He's going to leave", memory: "", skill: "" };
        const id = await repo.saveNote(jk, today, "pretend-mac-device", { ...note, steady: "Pretend: he came back every time" });
        const seen = (await repo.listNotes(jk)).notes[0].seen;
        await repo.saveNote(jk, today, "pretend-mac-device", { ...note, steady: "Pretend: he came back every time, and he said so" }, { id, seen });
        await new Promise((r) => setTimeout(r, 20));
        await repo.saveNote(jk, today, "pretend-phone-device", { ...note, steady: "Pretend: he stays, even when it's hard" }, { id, seen });
      });
      const s = page.getByRole("region", { name: "Notes to myself" });
      await expect(s.getByText(/^Another version \(from .+\)$/).first()).toBeVisible();
      await noSidewaysScroll(page);
      await shoot(page, `fix1-note-another-version-${width}`);
    });

    test("an unfinished morning page from days ago is offered back", async ({ page }) => {
      await unlocked(page, "/journal/morning");
      await expect(page.getByLabel("Today's morning page")).toBeVisible();
      await page.evaluate(async () => {
        const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
        const repo = await at("/src/data/repo.ts");
        const keys = await at("/src/journal/keyStore.ts");
        const engine = await at("/src/sync/engine.ts");
        const dates = await at("/src/domain/dates.ts");
        const { db } = await at("/src/data/db.ts");
        const jk = await keys.loadJournalKey(db);
        await repo.saveMorningDraft(jk, dates.addDays(dates.todayISO(), -3), await engine.getDeviceId(db), "Pretend words from a few days ago");
      });
      await page.reload();
      await expect(page.getByText(/^Your unfinished page from .+ is saved\.$/)).toBeVisible();
      await page.getByRole("button", { name: "Open that page" }).click();
      await expect(page.getByText(/^Finishing the page from /)).toBeVisible();
      await noSidewaysScroll(page);
      await shoot(page, `fix1-morning-older-page-${width}`);
    });
  });
}
