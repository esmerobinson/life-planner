import { expect, test, type Page } from "@playwright/test";
import { FakeSupabase } from "../src/together/fakeSupabase";
import { pageDate } from "./helpers";

/* Testing session (Life Planner - Together Round 7 Testing), 2026-11-06; converted to the challenge
   model 2026-11-09 (learned words and highlights go again, as research notes, 2026-11-08). In a
   real browser against a FAKE Together (made-up address, key, users and words; never anything
   real): what I learned typed in the real box, two highlights with notes, a morning page, a Note
   to myself and a to-do; Send now on the day, after 3am and 24 h later. Every request (address,
   headers, body) is scanned: only titles, questions, answers and that day's research notes go,
   the notes only with the answers, in one row of her challenge. WebKit (the Mac app's engine) by
   default; E2E_ENGINE=chromium for Chrome. */

const PASS = "fake-journal-e2e-passphrase";
const ENGINE = process.env.E2E_ENGINE === "chromium" ? "chromium" : "webkit";
test.use(ENGINE === "webkit" ? { browserName: "webkit", channel: "" } : {});
test.describe.configure({ retries: 2 }); // WebKit's occasional DataCloneError in the set-up's unlock

const ME = "00000000-0000-4000-8000-0000000000e5";
const COUPLE = "00000000-0000-4000-8000-00000000c0c0";
const EMAIL = "esme-pretend@example.test";
const PASSWORD = "pretend-together-password-7";
const LEARNED_LABEL = "What I learned about BPD or mental health today (optional)";
const CHALLENGE = "bpd-research";
const TITLE = "Pretend first workbook · Day 1 · Pretend first-book one";
const RESEARCH = ["• Pretend Brackwater lesson: a made-up wave passes", "• Pretend Corrieford — Pretend Corrieford note", "• Pretend Duntisbourne — Pretend Duntisbourne note"];
const NEVER = [
  "Pretend Eskdale morning page", "Pretend Eskdale hard thought", "Pretend Eskdale steady", "Pretend Eskdale to-do",
  "Highlighted learnings", "What I learned", PASS,
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, prefer",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

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
    const jkey = await at("/src/test/journalKey.ts");
    await db.journal.put(await jkey.verifierRow(await jkey.keyFor(pass)));
    await keys.unlockJournal(db, pass);
  }, PASS);
}

function after(day: string, days: number, hour: number, minute = 0): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d! + days, hour, minute);
}

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test(`${ENGINE}: learned words typed in the box and that day's highlights go as research notes with the answers; every other part never goes`, async ({ page }) => {
      test.setTimeout(150_000);
      const fake = await routeFake(page);
      const now = new Date();
      await page.clock.setFixedTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0));
      await unlocked(page);
      const day = await pageDate(page);
      await page.evaluate(async (d) => {
        const at = (p: string): Promise<any> => import(/* @vite-ignore */ p);
        const { db } = await at("/src/data/db.ts");
        const repo = await at("/src/data/repo.ts");
        const { parseCardFile } = await at("/src/journal/exercise.ts");
        const { FAKE_CARD_TEXT_BOOKS } = await at("/src/test/exerciseCards.ts");
        const { describeAnchor } = await at("/src/journal/highlights.ts");
        const keys = await at("/src/journal/keyStore.ts");
        const engine = await at("/src/sync/engine.ts");
        const jk = await keys.loadJournalKey(db);
        const dev = await engine.getDeviceId(db);
        const set = parseCardFile(FAKE_CARD_TEXT_BOOKS);
        await repo.importExerciseCards(jk, set, d);
        const card = set.cards.find((c: { id: string }) => c.id === "b-001");
        await repo.submitExerciseEntry(jk, d, dev, repo.cardRef(card), "Pretend Abbotsley exercise answer");
        const hcard = { id: "b-001", track: "bpd", book: "Pretend first workbook", day: 1, chapter: 1, chapterTitle: "Pretend meadow", theme: "Pretend first-book one" };
        for (const [words, note] of [["Pretend Corrieford", "Pretend Corrieford note"], ["Pretend Duntisbourne", "Pretend Duntisbourne note"]]) {
          const text = `A made-up learning text that says ${words} in the middle of it.`;
          const s = text.indexOf(words);
          await repo.createHighlight(jk, d, dev, hcard, describeAnchor("learn", text, s, s + words.length), note);
        }
        await repo.finishMorningPage(jk, d, dev, "Pretend Eskdale morning page");
        await repo.saveNote(jk, d, dev, { prompt: null, thought: "Pretend Eskdale hard thought", steady: "Pretend Eskdale steady", memory: "Pretend Eskdale steady", skill: "Pretend Eskdale steady" });
        await db.items.put({ id: "pretend-r7-todo", kind: "task", title: "Pretend Eskdale to-do", links: [], areaId: "mind", priority: 2, status: "open", createdAt: d, touchedAt: d });
      }, day);

      // Sign in on the Sync page.
      await page.goto("/sync");
      const box = page.getByRole("region", { name: "Together" });
      await box.getByLabel("Together address").fill(fake.url);
      await box.getByLabel("Together anon key").fill(fake.anonKey);
      await box.getByLabel("Together email").fill(EMAIL);
      await box.getByLabel("Together password").fill(PASSWORD);
      await box.getByRole("button", { name: "Sign in" }).click();
      await expect(box.getByText("Copying to Together from this device.")).toBeVisible();

      // What I learned, typed in the real box.
      await page.goto("/journal");
      const learned = page.getByLabel(LEARNED_LABEL);
      await learned.click();
      await learned.pressSequentially("Pretend Brackwater lesson: a made-up wave passes", { delay: 15 });
      await learned.blur();
      await expect.poll(() => page.evaluate(async () => {
        const { db } = await import(/* @vite-ignore */ "/src/data/db.ts" as string);
        return db.journal.where("kind").equals("learned").count();
      })).toBe(1);
      await page.reload();
      await expect(page.getByLabel(LEARNED_LABEL)).toHaveValue("Pretend Brackwater lesson: a made-up wave passes");

      // Send now: the day, after 3am, and 24 h later.
      for (const at of [null, after(day, 1, 3, 30), after(day, 2, 3, 30), after(day, 3, 9, 0)]) {
        if (at) await page.clock.setFixedTime(at);
        await page.goto("/sync");
        const lastSent = () => page.evaluate(async () => {
          const { db } = await import(/* @vite-ignore */ "/src/data/db.ts" as string);
          return ((await db.syncMeta.get("togetherSent"))?.value?.lastSentAt ?? 0) as number;
        });
        const before = await lastSent();
        await box.getByRole("button", { name: "Send now" }).click();
        await expect.poll(lastSent, "this Send now finished").not.toBe(before);
        await expect(box.getByRole("button", { name: "Send now" })).toBeEnabled();
      }
      await expect.poll(() => String(fake.dayRow(CHALLENGE, day)?.note ?? "")).toContain("Pretend Abbotsley exercise answer");

      // Every request, whole: address, headers, body.
      const wire = JSON.stringify(fake.requests.map((r) => ({ url: r.url, headers: r.headers, body: r.body })));
      for (const w of NEVER) expect(wire, w).not.toContain(JSON.stringify(w).slice(1, -1));
      expect(fake.requests.filter((r) => r.body.includes(PASSWORD))).toHaveLength(1);
      // One row, in her challenge; research notes only ever with the answers.
      expect(fake.days.size).toBe(1);
      const note = String(fake.dayRow(CHALLENGE, day)!.note);
      expect(note).toMatch(new RegExp(`^${TITLE}\n\n## Mental Health Exercise\n${TITLE}\n\n## Research notes\n`));
      for (const b of RESEARCH) expect(note).toContain(b);
      for (const line of note.split("\n")) expect(["## Mental Health Exercise", TITLE, "", "## Research notes", ...RESEARCH, "Pretend Abbotsley exercise answer"], line).toContain(line);
      for (const r of fake.requests.filter((x) => x.url.includes("challenge_days") && x.body.includes("Research notes"))) expect(r.body).toContain("Pretend Abbotsley exercise answer");
      expect(fake.todos.size + fake.events.size).toBe(0);

      // Still in Esmeworld: Read back shows the learned words and both highlights' notes.
      await page.goto("/journal/read-back");
      for (const [part, words] of [["Mental health exercise", ["Pretend Brackwater lesson: a made-up wave passes"]], ["Highlights", ["Pretend Corrieford note", "Pretend Duntisbourne note"]]] as const) {
        await expect(async () => {
          await page.locator("button.journal-readback-tile", { hasText: part }).click({ timeout: 2000 });
          await expect(page.locator("section.journal-readback-part").getByRole("heading", { level: 3, name: part })).toBeVisible({ timeout: 2000 });
        }).toPass({ timeout: 20_000 });
        const section = page.locator("section.journal-readback-part");
        for (const summary of await section.locator("details > summary").all()) await summary.click();
        for (const w of words) await expect(section.getByText(w).first(), `${part}: ${w}`).toBeVisible();
        await page.goto("/journal/read-back");
      }
    });
  });
}
