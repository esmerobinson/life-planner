import { expect, test, type Page } from "@playwright/test";

/* Changing the sync passphrase keeps the journal (bugs #3, #4; journal-rekey brief), in a real
   browser at 1280 and 390: a device whose journal was set up before the update saves the new
   passphrase on the Sync page, is asked once for the old one, and the new passphrase's
   locked copy of the journal key is then stored. A stand-in for the sync server (page.route)
   accepts only the new passphrase's token. All passphrases are fictional. Set SHOTS_DIR to
   save screenshots. */

const OLD = "fake-rekey-e2e-old-passphrase";
const NEW = "fake-rekey-e2e-new-passphrase";
const ADDRESS = "https://sync.example.test";

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

/** The stand-in server: answers a sync with nothing new for `token`, 401 for any other. */
async function fakeServer(page: Page, token: () => string | null) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, GET, OPTIONS",
  };
  await page.route(`${ADDRESS}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const ok = token() !== null && req.headers()["authorization"] === `Bearer ${token()}`;
    return route.fulfill({
      status: ok ? 200 : 401,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify(ok ? { cursor: 0, hasMore: false, changes: [] } : { error: "unauthorized" }),
    });
  });
}

/** This device as it was before the update: sync and journal set up with OLD (no copy of the journal secret). */
async function preUpdateDevice(page: Page): Promise<string> {
  let newToken: string | null = null;
  await fakeServer(page, () => newToken);
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  newToken = await page.evaluate(
    async ({ old, fresh, address }) => {
      const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
      const engine = await at("/src/sync/engine.ts");
      const token = await at("/src/sync/token.ts");
      const jkey = await at("/src/test/journalKey.ts");
      const { db } = await at("/src/data/db.ts");
      await engine.saveSyncSettings(db, { serverUrl: address, token: await token.deriveToken(old) });
      await jkey.confirmedDevice(db, await jkey.keyFor(old)); // the old way: key only
      return token.deriveToken(fresh);
    },
    { old: OLD, fresh: NEW, address: ADDRESS },
  );
  return newToken!;
}

async function keywrapRows(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const at = (path: string): Promise<any> => import(/* @vite-ignore */ path);
    const { db } = await at("/src/data/db.ts");
    return db.journal.where("kind").equals("keywrap").count();
  });
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function walkThrough(page: Page, prefix: string) {
  await preUpdateDevice(page);
  await page.goto("/sync");
  await page.getByLabel("Passphrase", { exact: true }).fill(NEW);
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  const prompt = page.getByRole("region", { name: "Type your old passphrase once" });
  await expect(prompt).toBeVisible({ timeout: 20_000 });
  await noSidewaysScroll(page);
  await shoot(page, `${prefix}-sync-old-passphrase`);

  await prompt.getByLabel("Old passphrase").fill(NEW);
  await prompt.getByRole("button", { name: "Save" }).click();
  await expect(prompt.getByRole("alert")).toHaveText("That isn't your old passphrase. Try again.");
  await expect(prompt.getByLabel("Old passphrase")).toHaveValue("");
  expect(await keywrapRows(page)).toBe(0);

  await prompt.getByLabel("Old passphrase").fill(OLD);
  await prompt.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Done. Your new passphrase now opens your journal on your other devices too.")).toBeVisible();
  await shoot(page, `${prefix}-sync-done`);
  await expect.poll(() => keywrapRows(page)).toBe(1);

  // The journal itself stayed open throughout, and asks nothing more.
  await page.goto("/journal/morning");
  await expect(page.getByLabel("Today's morning page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unlock journal" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Type your old passphrase once" })).toHaveCount(0);
}

async function journalPrompt(page: Page, prefix: string) {
  const newToken = await preUpdateDevice(page);
  // The new passphrase was saved on the Sync page and sync accepted it (no prompt answered yet).
  await page.evaluate(
    async ({ fresh, address, token }) => {
      const at = (path: string): Promise<any> => import(/* @vite-ignore */ path);
      const engine = await at("/src/sync/engine.ts");
      const keys = await at("/src/journal/keyStore.ts");
      const { db } = await at("/src/data/db.ts");
      await engine.saveSyncSettings(db, { serverUrl: address, token });
      await keys.saveJournalKeyFromSync(db, fresh);
    },
    { fresh: NEW, address: ADDRESS, token: newToken },
  );
  await page.goto("/journal/morning");
  const prompt = page.getByRole("region", { name: "Type your old passphrase once" });
  await expect(prompt).toBeVisible({ timeout: 20_000 }); // after the page's own sync
  await expect(page.getByLabel("Today's morning page")).toBeVisible(); // the journal is open under it
  await noSidewaysScroll(page);
  await shoot(page, `${prefix}-journal-old-passphrase`);
  await prompt.getByLabel("Old passphrase").fill(OLD);
  await prompt.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Done. Your new passphrase now opens your journal on your other devices too.")).toBeVisible();
  await expect.poll(() => keywrapRows(page)).toBe(1);
}

async function unlockWording(page: Page, prefix: string) {
  await page.goto("/");
  await page.evaluate(async (old) => {
    const at = (path: string): Promise<any> => import(/* @vite-ignore */ path);
    const jkey = await at("/src/test/journalKey.ts");
    const { db } = await at("/src/data/db.ts");
    await db.journal.put(await jkey.verifierRow(await jkey.keyFor(old)));
  }, OLD);
  await page.goto("/journal");
  await expect(page.getByText("If you changed the passphrase, your old one still works")).toBeVisible();
  await page.getByLabel("Sync passphrase").fill(NEW);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("alert")).toContainText("If you've just changed it, type the new one first on a device where the journal is open");
  await noSidewaysScroll(page);
  await shoot(page, `${prefix}-unlock-wrong`);
}

for (const [width, height] of [[1280, 900], [390, 844]] as const) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height } });
    test("Sync page: a new passphrase asks once for the old one, then the journal comes along", async ({ page }) => {
      test.setTimeout(120_000);
      await walkThrough(page, `rekey-${width}`);
    });
    test("Journal: the same one-time prompt over the open journal", async ({ page }) => {
      test.setTimeout(120_000);
      await journalPrompt(page, `rekey-${width}`);
    });
    test("Unlock wording covers both passphrases", async ({ page }) => {
      test.setTimeout(60_000);
      await unlockWording(page, `rekey-${width}`);
    });
  });
}

/* Review M6: the first-device path (no verifier anywhere yet). Unlock waits on "Checking your
   passphrase with sync…" (an acceptance recorded before the key was typed never counts, bug
   #4), then a fresh acceptance from a sync that finished after it opens the journal. */
async function firstDeviceUnlock(page: Page, prefix: string) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  await page.evaluate(
    async ({ old, address }) => {
      const at = (path: string): Promise<any> => import(/* @vite-ignore */ path);
      const engine = await at("/src/sync/engine.ts");
      const token = await at("/src/sync/token.ts");
      const { db } = await at("/src/data/db.ts");
      await engine.saveSyncSettings(db, { serverUrl: address, token: await token.deriveToken(old) });
      // A first sync accepted it long ago (before the key was typed): that must not count.
      await db.syncMeta.bulkPut([
        { key: "acceptedToken", value: (await db.syncMeta.get("token")).value },
        { key: "acceptedSeq", value: 1 },
      ]);
    },
    { old: OLD, address: ADDRESS },
  );
  await page.goto("/journal");
  await page.getByLabel("Sync passphrase").fill(OLD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("Checking your passphrase with sync…")).toBeVisible();
  await noSidewaysScroll(page);
  await shoot(page, `${prefix}-first-device-checking`);
  // The page's own sync can't reach the made-up address: a sync that finishes now accepts it.
  await page.evaluate(async () => {
    const at = (path: string): Promise<any> => import(/* @vite-ignore */ path);
    const { db } = await at("/src/data/db.ts");
    await db.syncMeta.put({ key: "acceptedSeq", value: ((await db.syncMeta.get("acceptedSeq"))?.value ?? 0) + 1 });
  });
  await expect(page.getByText("Add your exercise cards")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Checking your passphrase with sync…")).toHaveCount(0);
  const kinds = await page.evaluate(async () => {
    const at = (path: string): Promise<any> => import(/* @vite-ignore */ path);
    const { db } = await at("/src/data/db.ts");
    return (await db.journal.toArray()).map((r: { kind: string }) => r.kind);
  });
  expect(kinds).toContain("verifier"); // this device wrote the journal's check row
}

for (const [width, height] of [[1280, 900], [390, 844]] as const) {
  test.describe(`first device at ${width}px`, () => {
    test.use({ viewport: { width, height } });
    test("Unlock waits for a fresh sync, then opens (rule (b))", async ({ page }) => {
      test.setTimeout(60_000);
      await firstDeviceUnlock(page, `rekey-${width}`);
    });
  });
}
