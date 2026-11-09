import { expect, test, type Page } from "@playwright/test";
import { FakeSupabase } from "../src/together/fakeSupabase";
import { pageDate } from "./helpers";

/* The Together link in a real browser, against a FAKE Together server (made-up address, key,
   users and words; it never contacts anything real): sign in, do the day's exercise (and write
   what she learned) and check-in, pass 3am (titles and questions only), then 24 hours more (her
   answers and research notes), and check the fake holds one row for the day in her challenge
   (renamed Mental Health Work) and no to-do. The look is a
   placeholder. Set SHOTS_DIR to save screenshots. */

const PASS = "fake-journal-e2e-passphrase";
const ME = "00000000-0000-4000-8000-0000000000e5";
const COUPLE = "00000000-0000-4000-8000-00000000c0c0";
const EMAIL = "esme-pretend@example.test";
const PASSWORD = "pretend-together-password-7";
const CHALLENGE = "bpd-research";

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, prefer",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

/** Every request to the fake Together address is answered by the in-memory fake. */
async function routeFake(page: Page): Promise<FakeSupabase> {
  const fake = new FakeSupabase();
  fake.addUser(EMAIL, PASSWORD, ME, COUPLE);
  fake.addChallenge({ id: CHALLENGE, couple_id: COUPLE, name: "BPD research", for_user: ME });
  await page.route(`${fake.url}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const res = await fake.fetch(req.url(), { method: req.method(), headers: req.headers(), body: req.postData() ?? undefined });
    return route.fulfill({ status: res.status, headers: { ...CORS, "Content-Type": "application/json" }, body: await res.text() });
  });
  return fake;
}

/** Sync set up for PASS (a made-up address that never answers) and the journal unlocked. */
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
    // The journal was set up on another device: its check row is here (journal re-key flow).
    const jkey = await at("/src/test/journalKey.ts");
    await db.journal.put(await jkey.verifierRow(await jkey.keyFor(pass)));
    await keys.unlockJournal(db, pass);
  }, PASS);
}

async function noSidewaysScroll(page: Page) {
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(m.s).toBeLessThanOrEqual(m.w);
}

/** A local time `days` calendar days after `day` (YYYY-MM-DD). */
function after(day: string, days: number, hour: number, minute = 0): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d! + days, hour, minute);
}

const days = (fake: FakeSupabase) => fake.dayRows(CHALLENGE);

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("sign in, do the day's exercise and check-in, pass 3am, then 24 hours more: the fake holds the right rows", async ({ page }) => {
      test.setTimeout(120_000);
      const fake = await routeFake(page);
      const now = new Date();
      await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0));
      await unlocked(page);
      const day = await pageDate(page);
      // A to-do that must never go, and the day's exercise card (made-up), done.
      await page.evaluate(async (d) => {
        const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
        const { db } = await at("/src/data/db.ts");
        const repo = await at("/src/data/repo.ts");
        const { parseCardFile } = await at("/src/journal/exercise.ts");
        const { FAKE_CARD_TEXT_BOOKS } = await at("/src/test/exerciseCards.ts");
        const keys = await at("/src/journal/keyStore.ts");
        const engine = await at("/src/sync/engine.ts");
        await db.items.put({ id: "pretend-todo", kind: "task", title: "Pretend to-do that never goes", links: [], areaId: "admin", priority: 2, status: "open", createdAt: d, touchedAt: d });
        const jk = await keys.loadJournalKey(db);
        const set = parseCardFile(FAKE_CARD_TEXT_BOOKS);
        await repo.importExerciseCards(jk, set, d);
        const card = set.cards.find((c: { id: string }) => c.id === "b-001");
        await repo.submitExerciseEntry(jk, d, await engine.getDeviceId(db), repo.cardRef(card), "Pretend exercise answer");
      }, day);

      // Sign in to the fake Together on the Sync page.
      await page.goto("/sync");
      const box = page.getByRole("region", { name: "Together" });
      await expect(box.getByText(/replaces that day's entry in Together/)).toHaveCount(0); // said once signed in
      await box.getByLabel("Together address").fill(fake.url);
      await box.getByLabel("Together anon key").fill(fake.anonKey);
      await box.getByLabel("Together email").fill(EMAIL);
      await box.getByLabel("Together password").fill(PASSWORD);
      await shoot(page, `together-sign-in-${width}`);
      await box.getByRole("button", { name: "Sign in" }).click();
      await expect(box.getByText("Copying to Together from this device.")).toBeVisible();
      await expect(box.getByText(/replaces that day's entry in Together/).first()).toBeVisible();
      await expect(box.getByText(/^Past days' answers go on .*Tick any day private before then\.$/)).toBeVisible();
      const stored = await page.evaluate(async () => {
        const { db } = await import(/* @vite-ignore */ "/src/data/db.ts" as string);
        return JSON.stringify(await db.syncMeta.toArray());
      });
      expect(stored).not.toContain(PASSWORD);
      await noSidewaysScroll(page);
      await shoot(page, `together-box-${width}`);

      // What she learned today: typed, kept across a reload.
      await page.goto("/journal");
      const learned = page.getByLabel("What I learned about BPD or mental health today (optional)");
      await learned.click();
      await learned.pressSequentially("Pretend: a wave passes", { delay: 20 });
      await learned.blur(); // leave the box
      await expect.poll(() => page.evaluate(async () => {
        const { db } = await import(/* @vite-ignore */ "/src/data/db.ts" as string);
        return db.journal.where("kind").equals("learned").count();
      })).toBe(1);
      const sealed = await page.evaluate(async () => {
        const { db } = await import(/* @vite-ignore */ "/src/data/db.ts" as string);
        return JSON.stringify(await db.journal.where("kind").equals("learned").toArray());
      });
      expect(sealed).not.toContain("wave"); // saved sealed
      await page.reload();
      await expect(page.getByLabel("What I learned about BPD or mental health today (optional)")).toHaveValue("Pretend: a wave passes");
      await expect(page.getByText("Oliver still sees that you did the exercise, the card's title and its questions.")).toBeVisible();
      await noSidewaysScroll(page);
      await shoot(page, `together-exercise-learned-${width}`);

      // Finish a check-in, with the private tick under it left off.
      await page.goto("/journal/check-in");
      const s = page.getByRole("region", { name: "Daily check-in" });
      await expect(page.getByText("Keep today's answers private")).toBeVisible();
      for (let i = 0; i < 3; i++) {
        await expect(s.getByRole("img", { name: `Question ${i + 1} of 3` })).toBeVisible();
        await s.getByLabel("Your answer").fill(`Pretend answer ${i + 1}`);
        await s.getByRole("button", { name: i === 2 ? "Finish" : "Next →" }).click();
      }
      await expect(s.getByText("Checked in for today")).toBeVisible();
      await noSidewaysScroll(page);
      await shoot(page, `together-checkin-tick-${width}`);

      // Send now the same day: her challenge found and renamed, no day yet (the made-up sync
      // address never answers, so no sync run triggers it).
      await page.goto("/sync");
      await box.getByRole("button", { name: "Send now" }).click();
      await expect(box.getByText(/^Last copied/)).toBeVisible();
      await expect.poll(() => fake.challenges.get(CHALLENGE)!.name).toBe("Mental Health Work");
      expect(fake.todos.size + fake.events.size).toBe(0);
      expect(days(fake)).toHaveLength(0);

      // Past 3am: one row for the day, titles and questions only.
      await page.clock.setFixedTime(after(day, 1, 3, 30));
      await page.reload();
      await box.getByRole("button", { name: "Send now" }).click();
      await expect.poll(() => days(fake).length).toBe(1);
      const first = days(fake)[0]!;
      expect(first).toMatchObject({ couple_id: COUPLE, challenge_id: CHALLENGE, day, by: ME, deleted_at: null });
      expect(String(first.note)).toMatch(/^[^\n]*Pretend first-book one · Check In\n\n## Mental Health Exercise\n.*Pretend first-book one\n\n## Check In\n\*\*/);
      expect(String(first.note)).not.toMatch(/Pretend answer|Pretend exercise answer|a wave passes|Research notes/);

      // 24 hours after the day ended: the same row now holds her answers and research notes.
      await page.clock.setFixedTime(after(day, 2, 3, 30));
      await page.reload();
      await box.getByRole("button", { name: "Send now" }).click();
      await expect.poll(() => String(days(fake)[0]!.note)).toContain("Pretend answer 1");
      expect(days(fake)).toHaveLength(1);
      const note = String(days(fake)[0]!.note);
      expect(note).toContain("## Research notes\n• Pretend: a wave passes");
      expect(note).toContain("Pretend exercise answer");
      expect(note).toMatch(/\n\n## Check In\n\*\*[^\n]+\*\*\nPretend answer 1/);
      expect(fake.todos.size + fake.events.size).toBe(0);

      // Nothing forbidden went: no to-do, no password after sign-in, no sync passphrase.
      const wire = JSON.stringify(fake.requests.map((r) => ({ url: r.url, headers: r.headers, body: r.body })));
      expect(wire).not.toContain("Pretend to-do that never goes");
      expect(fake.requests.filter((r) => r.body.includes(PASSWORD))).toHaveLength(1);
      expect(wire).not.toContain(PASS);
      await shoot(page, `together-after-answers-${width}`);
    });
  });
}
