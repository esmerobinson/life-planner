import { expect, test, type Page } from "@playwright/test";
import { FakeSupabase } from "../src/together/fakeSupabase";
import { pageDate } from "./helpers";

/* "What I did" (Esme, 19 Nov 2026) in a real browser, at the Mac's width and the phone's: a
   to-do tick asks "What did you do?" (Save, Skip, Escape keeps the typing), the log by week, ⌘K /
   🔍 search finds a note, the Sunday weekly review shows "Completed this week", and none of it
   goes to Together (a FAKE Together server, made-up address and words). The Mac app's file
   bridge is pretended with an init script. All data is fictional. Set SHOTS_DIR for screenshots. */

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

async function noSidewaysScroll(page: Page) {
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(m.s).toBeLessThanOrEqual(m.w);
}

/** Puts rows straight into the app's own database (the dev server's modules). */
async function seed(page: Page, rows: unknown[]) {
  await page.evaluate(async (list) => {
    const { db } = await import(/* @vite-ignore */ "/src/data/db.ts" as string);
    await db.items.bulkPut(list);
  }, rows);
}

const item = (id: string, day: string, extra: Record<string, unknown> = {}) => ({
  id, kind: "task", title: `Pretend ${id}`, links: [], areaId: "writing", priority: 2, status: "open",
  createdAt: day, touchedAt: day, ...extra,
});

const readItem = (page: Page, id: string) =>
  page.evaluate(async (i) => {
    const { db } = await import(/* @vite-ignore */ "/src/data/db.ts" as string);
    return db.items.get(i);
  }, id);

/** The Mac app's file bridge, pretended: every message is recorded; Attach "copies" one file. */
async function pretendMac(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const sent: unknown[] = [];
    w.__files = sent;
    w.webkit = {
      messageHandlers: {
        esmeworldReminders: { postMessage: async () => ({ status: "denied", scheduled: 0, pending: 0 }) },
        esmeworldFiles: {
          postMessage: async (m: { action: string; root?: string; parts?: string[] }) => {
            sent.push(m);
            if (m.action === "attach") return { saved: [{ name: "pretend draft.docx", folder: `${m.root}/${m.parts!.join("/")}` }], failed: [] };
            if (m.action === "getRoot") return { root: "~/Desktop" };
            if (m.action === "reveal") return { ok: true };
            return { cancelled: true };
          },
        },
      },
    };
  });
}

const sheet = (page: Page) => page.getByRole("dialog", { name: "What did you do?" });

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("tick → asked → the note is saved; Skip leaves it done; Escape keeps the typing", async ({ page }) => {
      await page.goto("/");
      const day = await pageDate(page);
      await seed(page, [item("chapter", day), item("letter", day), item("essay", day)]);
      await page.goto("/area/writing");

      await page.getByRole("checkbox", { name: "Mark done: Pretend chapter" }).click();
      await expect(sheet(page)).toBeVisible();
      const box = sheet(page).getByRole("textbox", { name: "What did you do?" });
      await expect(box).toBeFocused();
      await expect(sheet(page).getByText("Attach files on your Mac")).toBeVisible();
      await expect(sheet(page).getByRole("button", { name: "Attach files" })).toHaveCount(0);
      expect((await readItem(page, "chapter")).status).toBe("done");
      await noSidewaysScroll(page);
      await shoot(page, `what-i-did-sheet-${width}`);
      await box.pressSequentially("Pretend wrote the harbour scene", { delay: 10 });
      await sheet(page).getByRole("button", { name: "Save" }).click();
      await expect(sheet(page)).toHaveCount(0);
      await expect.poll(async () => (await readItem(page, "chapter")).did?.[0]?.note).toBe("Pretend wrote the harbour scene");

      await page.getByRole("checkbox", { name: "Mark done: Pretend letter" }).click();
      await sheet(page).getByRole("button", { name: "Skip" }).click();
      await expect(sheet(page)).toHaveCount(0);
      const letter = await readItem(page, "letter");
      expect(letter.status).toBe("done");
      expect(letter.did).toBeUndefined();

      await page.getByRole("checkbox", { name: "Mark done: Pretend essay" }).click();
      await sheet(page).getByRole("textbox").pressSequentially("Pretend half a thought", { delay: 10 });
      await page.keyboard.press("Escape");
      await expect(sheet(page)).toHaveCount(0);
      await expect.poll(async () => (await readItem(page, "essay")).did?.[0]?.note).toBe("Pretend half a thought");
      // Kept across a reload, and there to edit in the side panel.
      await page.goto("/area/writing?open=essay");
      const panel = page.getByRole("region", { name: "What I did" });
      await expect(panel.getByRole("textbox", { name: "What I did" })).toHaveValue("Pretend half a thought");
      await shoot(page, `what-i-did-panel-${width}`);
    });

    test("never costs a click (review I1): three to-dos ticked quickly in a row are all done", async ({ page }) => {
      await page.goto("/");
      const day = await pageDate(page);
      await seed(page, [item("one", day), item("two", day), item("three", day)]);
      await page.goto("/area/writing");
      for (const t of ["one", "two", "three"]) await page.getByRole("checkbox", { name: `Mark done: Pretend ${t}` }).click();
      for (const t of ["one", "two", "three"]) await expect.poll(async () => (await readItem(page, t)).status).toBe("done");
      // Only the last one's card is open, about that one.
      await expect(sheet(page)).toHaveCount(1);
      await expect(sheet(page).getByText("Pretend three")).toBeVisible();
      await noSidewaysScroll(page);
      await shoot(page, `what-i-did-three-ticks-${width}`);
    });

    test("typed, then the page reloads at once (before the pause save): the words are kept (review R5)", async ({ page }) => {
      await page.goto("/");
      const day = await pageDate(page);
      await seed(page, [item("fast", day)]);
      await page.goto("/area/writing");
      await page.getByRole("checkbox", { name: "Mark done: Pretend fast" }).click();
      await sheet(page).getByRole("textbox").pressSequentially("Pretend fast words", { delay: 5 });
      await page.reload();
      await expect.poll(async () => (await readItem(page, "fast")).did?.[0]?.note).toBe("Pretend fast words");
    });

    test("in the Mac app (bridge pretended): Attach files copies into the area's folder and lists the file", async ({ page }) => {
      await pretendMac(page);
      await page.goto("/");
      const day = await pageDate(page);
      await seed(page, [item("zine", day, { areaId: "art", sessions: [{ id: "s1" }, { id: "s2" }], title: "Pretend zine" })]);
      await page.goto("/area/art");
      await page.getByRole("checkbox", { name: "Log a session: Pretend zine" }).click();
      await sheet(page).getByRole("button", { name: "Attach files" }).click();
      await expect(sheet(page).getByRole("button", { name: "pretend draft.docx" })).toBeVisible();
      const sent = await page.evaluate(() => (window as unknown as { __files: unknown[] }).__files);
      expect(sent.find((m) => (m as { action: string }).action === "attach")).toEqual({ action: "attach", root: "~/Desktop", parts: ["Art", "Pretend zine"] });
      await sheet(page).getByRole("button", { name: "Save" }).click();
      await expect.poll(async () => (await readItem(page, "zine")).did?.[0]).toMatchObject({
        session: "s1", files: [{ name: "pretend draft.docx", folder: "~/Desktop/Art/Pretend zine" }],
      });
      // The folder setting is on the log page in the Mac app.
      await page.goto("/what-i-did");
      await expect(page.getByRole("region", { name: "Where files go" })).toBeVisible();
      await noSidewaysScroll(page);
    });

    test("the log, week by week, from the footer link; filter by area; search finds a note and opens it", async ({ page }) => {
      await page.goto("/");
      const today = await pageDate(page);
      const lastWeek = await pageDate(page, -7);
      await seed(page, [
        item("harbour", today, { status: "done", completedAt: today, did: [{ id: "e1", on: today, note: "Pretend Saltmere harbour scene", files: [{ name: "saltmere.docx", folder: "~/Desktop/Writing" }] }] }),
        item("tax", lastWeek, { areaId: "admin", status: "done", completedAt: lastWeek, did: [{ id: "e2", on: lastWeek, note: "Pretend filed the Brindle form" }] }),
      ]);
      await page.goto("/");
      const footer = width < 700 ? page.getByRole("navigation", { name: "More" }) : page.locator(".sidebar-footer");
      await footer.getByRole("link", { name: "What I did" }).click();
      await expect(page).toHaveURL(/\/what-i-did$/);
      const weeks = page.getByRole("region", { name: /^Week of/ });
      await expect(weeks).toHaveCount(2);
      await expect(weeks.nth(0)).toContainText("Pretend Saltmere harbour scene");
      await expect(weeks.nth(0)).toContainText("saltmere.docx");
      await expect(weeks.nth(1)).toContainText("Pretend filed the Brindle form");
      await page.getByRole("group", { name: "Area" }).getByRole("button", { name: "Admin" }).click();
      await expect(page.getByText("Pretend Saltmere harbour scene")).toHaveCount(0);
      await expect(page.getByText("Pretend filed the Brindle form")).toBeVisible();
      await noSidewaysScroll(page);
      await shoot(page, `what-i-did-log-${width}`);

      // Search: ⌘K on the Mac, 🔍 on the phone.
      await page.goto("/");
      if (width < 700) await page.getByRole("button", { name: "Search" }).click();
      else await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
      await page.getByRole("combobox").fill("brindle");
      const hit = page.getByRole("option", { name: /Pretend tax/ });
      await expect(hit).toContainText("What I did");
      await hit.click();
      await expect(page).toHaveURL(/\/what-i-did\?entry=tax%3Ae2$/);
      await expect(page.locator('[id="did-tax:e2"]')).toHaveClass(/is-target/);
    });

    test("the Sunday weekly review shows Completed this week; none of it goes to Together", async ({ page }) => {
      test.setTimeout(120_000);
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
      const sunday = new Date();
      sunday.setDate(sunday.getDate() + ((7 - sunday.getDay()) % 7));
      sunday.setHours(12, 0, 0, 0);
      await page.clock.setFixedTime(sunday);
      await page.goto("/");
      await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
      const day = await pageDate(page);
      const tuesday = await pageDate(page, -5);
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
      await seed(page, [
        item("mapping", tuesday, { title: "Pretend Quorrel mapping", status: "done", completedAt: tuesday, did: [{ id: "e1", on: tuesday, note: "Pretend drew the Quorrel coast", files: [{ name: "quorrel.png", folder: "~/Desktop/Art" }] }], areaId: "art" }),
      ]);

      await page.goto("/journal/exercise");
      const review = page.getByRole("region", { name: "Weekly review" });
      const done = review.getByRole("list", { name: "Completed this week" });
      await expect(done.getByRole("listitem")).toHaveCount(1);
      await expect(done).toContainText("Pretend Quorrel mapping");
      await expect(done).toContainText("Pretend drew the Quorrel coast");
      await expect(done.getByRole("textbox")).toHaveCount(0);
      await noSidewaysScroll(page);
      await shoot(page, `what-i-did-review-${width}`);

      // The review answered and Done; then Send now to the fake Together.
      await review.getByLabel("What went well?").fill("Pretend Vellwick week went well");
      await review.getByLabel("What went well?").blur();
      await review.getByRole("button", { name: "Done" }).click();
      await expect(review.getByText("Weekly review done for this week")).toBeVisible();

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
      expect(String(fake.dayRows(CHALLENGE)[0]!.note)).toContain("Pretend Vellwick week went well");
      expect(fake.dayRows(CHALLENGE)[0]!.day).toBe(day);
      // Not a word of the list, in any request.
      const everything = JSON.stringify(fake.requests);
      for (const word of ["Quorrel", "quorrel.png", "~/Desktop/Art", "Pretend Quorrel mapping"]) expect(everything).not.toContain(word);
      expect(fake.todos.size + fake.events.size).toBe(0);
    });
  });
}
