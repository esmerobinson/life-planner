import { expect, test, type Locator, type Page } from "@playwright/test";
import { FakeSupabase } from "../src/together/fakeSupabase";

/* Weekly review v2 (Esme, 17 and 23 Nov 2026) in a real browser, at the phone's width and the
   Mac's: its own Journal tab; the title "Weekly Review [MM-DD-YYYY-MM-DD-YYYY]" and which week
   opens (Monday: last week's, with a switch); Yes opening its boxes; typing kept across a reload;
   Done counting as that day's Mental health work and readable in Read back; and Together (a FAKE
   server, made-up address) getting only "Weekly review done", nothing she wrote or picked.
   FICTIONAL words only. */

const PASS = "fake-journal-e2e-passphrase";
const ME = "00000000-0000-4000-8000-0000000000e5";
const COUPLE = "00000000-0000-4000-8000-00000000c0c0";
const EMAIL = "esme-pretend@example.test";
const PASSWORD = "pretend-together-password-7";
const CHALLENGE = "bpd-research";
const THINK_MS = 1500;

const WORDS = {
  happened: "Pretend Corrowind happened, a made-up evening",
  trigger: "Pretend Corrowind trigger: a made-up late train",
  more: "Pretend Corrowind more reflections about a made-up garden",
};

/** The next Monday (today, if it is Monday) at noon, local time. */
function nextMondayNoon(): Date {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7));
  d.setHours(12, 0, 0, 0);
  return d;
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const us = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;
const title = (monday: Date) => `Weekly Review [${us(monday)}-${us(plus(monday, 6))}]`;
const longDate = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

async function unlocked(page: Page, path: string) {
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
  await page.goto(path);
}

async function typeLikeAPerson(page: Page, box: Locator, words: string, away?: Locator) {
  await box.click();
  await box.press("End");
  await box.pressSequentially(words, { delay: 20 });
  await page.waitForTimeout(THINK_MS);
  if (away) await away.click();
}

async function noSidewaysScroll(page: Page) {
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(m.s).toBeLessThanOrEqual(m.w);
}

const review = (page: Page) => page.getByRole("region", { name: "Weekly review" });
const group = (page: Page, name: string) => review(page).getByRole("group", { name });

/** Every IndexedDB row and local/session storage, as text: none of `words` may be in it. */
async function noWordsInClear(page: Page, words: string[]) {
  const dump = await page.evaluate(async () => {
    const parts: string[] = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })];
    for (const info of await indexedDB.databases()) {
      const idb: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open(info.name!);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      for (const store of Array.from(idb.objectStoreNames)) {
        const rows: unknown[] = await new Promise((res, rej) => {
          const r = idb.transaction(store, "readonly").objectStore(store).getAll();
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        parts.push(JSON.stringify(rows));
      }
      idb.close();
    }
    return parts.join("\n");
  });
  expect(dump).toContain("weekly-review:");
  for (const w of words) expect(dump, `"${w}" is stored in clear`).not.toContain(w);
}

for (const width of [390, 1280]) {
  test.describe(`Weekly review v2 at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("its own tab; Monday opens last week's (switch to this week and back); Yes opens its boxes; typing survives a reload; Done counts and is in Read back", async ({ page }) => {
      test.setTimeout(150_000);
      const monday = nextMondayNoon();
      await page.clock.install({ time: monday });
      await unlocked(page, "/journal/exercise");
      // The tab, next to the others; the old box is gone from the Mental health exercise tab.
      const tabs = page.getByRole("navigation", { name: "Journal parts" });
      await expect(tabs.getByRole("link", { name: "Weekly review" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Mental health exercise" })).toBeVisible();
      await expect(page.getByLabel("What went well?")).toHaveCount(0); // the old box is gone from here
      await expect(async () => {
        await tabs.getByRole("link", { name: "Weekly review" }).click();
        await expect(page).toHaveURL(/\/journal\/weekly-review$/, { timeout: 1000 });
      }).toPass({ timeout: 15_000 });

      const lastMonday = plus(monday, -7);
      const s = review(page);
      await expect(s.getByRole("heading", { name: title(lastMonday) })).toBeVisible();
      await s.getByRole("button", { name: "Switch to this week" }).click();
      await expect(s.getByRole("heading", { name: title(monday) })).toBeVisible();
      await s.getByRole("button", { name: "Switch to last week" }).click();
      await expect(s.getByRole("heading", { name: title(lastMonday) })).toBeVisible();
      await noSidewaysScroll(page);

      // Yes opens its boxes.
      await expect(s.getByLabel("What happened?")).toHaveCount(0);
      await group(page, "Did you self harm this week?").getByRole("button", { name: "Yes" }).click();
      const away = s.getByRole("heading", { name: title(lastMonday) });
      await typeLikeAPerson(page, s.getByLabel("What happened?"), WORDS.happened, away);
      await expect(s.getByLabel("What about?")).toHaveCount(0);
      await group(page, "Did you fight with Oliver?").getByRole("button", { name: "Yes" }).click();
      await expect(s.getByLabel("What about?")).toBeVisible();
      await expect(s.getByLabel("How did you resolve it?")).toBeVisible();
      await typeLikeAPerson(page, s.getByLabel("What was the trigger?"), WORDS.trigger, away);
      await group(page, "How was your sleep overall?").getByRole("button", { name: "Poor" }).click();
      await typeLikeAPerson(page, s.getByLabel("More reflections"), WORDS.more);
      await page.waitForTimeout(THINK_MS);

      await page.reload();
      await expect(review(page).getByRole("heading", { name: title(lastMonday) })).toBeVisible(); // still last week's: not done
      await expect(review(page).getByLabel("What happened?")).toHaveValue(WORDS.happened);
      await expect(review(page).getByLabel("What was the trigger?")).toHaveValue(WORDS.trigger);
      await expect(review(page).getByLabel("More reflections")).toHaveValue(WORDS.more);
      await expect(group(page, "How was your sleep overall?").getByRole("button", { name: "Poor" })).toHaveAttribute("aria-pressed", "true");

      await review(page).getByRole("button", { name: "Done" }).click();
      await expect(review(page).getByText("Weekly review done", { exact: true })).toBeVisible();
      await expect(review(page).getByText(WORDS.happened)).toBeVisible();
      await expect(review(page).getByRole("textbox")).toHaveCount(0);

      // Mental health work today: the Mental health exercise tab ticks.
      const exerciseLink = tabs.getByRole("link", { name: /Mental health exercise/ });
      await expect(exerciseLink.locator(".tick-auto.is-done")).toBeVisible();

      // Reopened on Monday with last week's done: this week's opens, and last week's is listed, word for word.
      await page.reload();
      await expect(review(page).getByRole("heading", { name: title(monday) })).toBeVisible();
      const past = page.getByRole("region", { name: "Past weekly reviews" });
      const done = past.locator("details", { has: page.locator(`summary:text-is("${title(lastMonday)}")`) });
      await done.locator("> summary").click();
      await expect(done.getByText(WORDS.trigger)).toBeVisible();
      await expect(done.getByRole("textbox")).toHaveCount(0);

      // Read back: in the Mental health exercise part, on the day she pressed Done, word for word.
      // (The tabs can still move into their stacked layout just after the Journal opens: tap again.)
      await expect(async () => {
        await tabs.getByRole("link", { name: "Read back" }).click();
        await expect(page).toHaveURL(/\/journal\/read-back/, { timeout: 1000 });
      }).toPass({ timeout: 15_000 });
      await page.locator("button.journal-readback-tile", { hasText: "Mental health exercise" }).click();
      const part = page.locator("section.journal-readback-part");
      await expect(part.getByRole("heading", { level: 3, name: "Mental health exercise" })).toBeVisible();
      const item = part.locator("details", { has: page.locator(`summary:text-is("${longDate(monday)} · ${title(lastMonday)}")`) });
      await expect(item).toHaveCount(1);
      await item.locator("> summary").click();
      for (const w of Object.values(WORDS)) await expect(item.getByText(w)).toBeVisible();
      await expect(item.getByText("Poor", { exact: true })).toBeVisible();
      await noSidewaysScroll(page);

      await noWordsInClear(page, [...Object.values(WORDS), "Corrowind"]);
    });

    test("Together gets only \"Weekly review done\": no answers, no questions, no yes or no", async ({ page }) => {
      test.setTimeout(150_000);
      const fake = new FakeSupabase();
      fake.addUser(EMAIL, PASSWORD, ME, COUPLE);
      fake.addChallenge({ id: CHALLENGE, couple_id: COUPLE, name: "BPD research", for_user: ME });
      const CORS = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "apikey, authorization, content-type, prefer",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      };
      await page.route(`${fake.url}/**`, async (route) => {
        const req = route.request();
        if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
        const res = await fake.fetch(req.url(), { method: req.method(), headers: req.headers(), body: req.postData() ?? undefined });
        return route.fulfill({ status: res.status, headers: { ...CORS, "Content-Type": "application/json" }, body: await res.text() });
      });
      const friday = plus(nextMondayNoon(), 4);
      await page.clock.setFixedTime(friday);
      await unlocked(page, "/journal/weekly-review");
      const s = review(page);
      await expect(s.getByRole("heading", { name: title(plus(friday, -4)) })).toBeVisible();
      for (const q of ["Did you self harm this week?", "Did you have urges to self-harm, even if you didn't act on them?", "Did you fight with Oliver?"]) {
        await group(page, q).getByRole("button", { name: "Yes" }).click();
      }
      await s.getByLabel("What happened?").fill(WORDS.happened);
      await s.getByLabel("What was the trigger?").fill(WORDS.trigger);
      await s.getByLabel("More reflections").fill(WORDS.more);
      await s.getByLabel("More reflections").blur();
      await group(page, "Were you productive?").getByRole("button", { name: "Partly" }).click();
      await s.getByRole("button", { name: "Done" }).click();
      await expect(s.getByText("Weekly review done", { exact: true })).toBeVisible();

      await page.goto("/sync");
      const box = page.getByRole("region", { name: "Together" });
      await box.getByLabel("Together address").fill(fake.url);
      await box.getByLabel("Together anon key").fill(fake.anonKey);
      await box.getByLabel("Together email").fill(EMAIL);
      await box.getByLabel("Together password").fill(PASSWORD);
      await box.getByRole("button", { name: "Sign in" }).click();
      await expect(box.getByText("Copying to Together from this device.")).toBeVisible();
      await box.getByRole("button", { name: "Send now" }).click();
      await expect(box.getByText(/^Last copied/)).toBeVisible();
      await expect.poll(() => fake.dayRows(CHALLENGE).length).toBe(1);
      const row = fake.dayRows(CHALLENGE)[0]!;
      expect(row.day).toBe(iso(friday));
      expect(String(row.note)).toBe("Weekly review done\n\n## Mental Health Exercise\n\nWeekly review done");
      const everything = JSON.stringify(fake.requests);
      for (const w of [...Object.values(WORDS), "Corrowind", "self harm", "self-harm", "Oliver", "What happened", "trigger", "More reflections", "Partly"]) {
        expect(everything).not.toContain(w);
      }
      for (const r of fake.requests.filter((x) => x.url.includes("/rest/v1/challenge_days"))) expect(String(r.body ?? "")).not.toMatch(/\b(yes|no|partly)\b/i);
      expect(fake.todos.size + fake.events.size).toBe(0);
    });
  });
}
