import { expect, test, type Page } from "@playwright/test";

/* One-tap quick add on the phone (Esme, 2026-11-17) at 390px in a real browser: the + opens one
   box, focused inside the tap (iOS only raises the keyboard for that); Return saves to the Inbox
   and the sheet stays open; Today / Tomorrow / Time chips; the half-typed entry survives closing
   and a reload; /add opens straight into it. All data is fictional. */

test.use({ viewport: { width: 390, height: 844 } });

const sheet = (page: Page) => page.getByRole("dialog", { name: "Add" });
const box = (page: Page) => sheet(page).getByRole("textbox", { name: "What's on your mind?" });

async function home(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
}

test("the + focuses the box within the tap itself, not in a later effect", async ({ page }) => {
  await home(page);
  const focusedInTap = await page.evaluate(() => {
    (document.querySelector("button.add-fab") as HTMLButtonElement).click();
    // Checked before this script returns: no microtask, timer or frame has run since the click.
    const el = document.activeElement as HTMLInputElement | null;
    return el?.closest(".quick-capture") !== null && el?.type === "text";
  });
  expect(focusedInTap).toBe(true);
  await expect(box(page)).toBeFocused();
  // No full form on the phone's +.
  await expect(sheet(page).getByRole("button", { name: "Add item" })).toHaveCount(0);
});

test("Return saves to the Inbox, says Added, clears the box and stays open for the next", async ({ page }) => {
  await home(page);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.keyboard.type("Pretend post the parcel");
  await page.keyboard.press("Enter");
  await expect(sheet(page).getByRole("status")).toHaveText("Added");
  await expect(box(page)).toHaveValue("");
  await expect(box(page)).toBeFocused();
  await page.keyboard.type("Pretend water the plants");
  await expect(sheet(page).getByRole("status")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(sheet(page).getByRole("status")).toHaveText("Added");
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Close" }).click();
  await page.goto("/inbox");
  await expect(page.getByText("Pretend post the parcel")).toBeVisible();
  await expect(page.getByText("Pretend water the plants")).toBeVisible();
});

test("chips: Today puts it on Today; Time with no day is today at that time", async ({ page }) => {
  await home(page);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await sheet(page).getByRole("button", { name: "Today" }).click();
  await expect(sheet(page).getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "true");
  await box(page).fill("Pretend today thing");
  await box(page).press("Enter");
  await expect(sheet(page).getByRole("status")).toHaveText("Added");
  // Chips start fresh for the next one.
  await expect(sheet(page).getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "false");
  await sheet(page).getByRole("button", { name: "Time" }).click();
  await sheet(page).getByLabel("Time", { exact: true }).fill("15:00");
  await expect(sheet(page).getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "true");
  await box(page).fill("Pretend timed thing");
  await box(page).press("Enter");
  await expect(sheet(page).getByRole("status")).toHaveText("Added");
  await sheet(page).getByRole("button", { name: "Close" }).click();
  const today = page.getByRole("list", { name: "Today" });
  await expect(today.getByText("Pretend today thing")).toBeVisible();
  const timed = today.locator("li", { hasText: "Pretend timed thing" });
  await expect(timed.getByText("3:00pm")).toBeVisible();
});

test("Tomorrow keeps it off Today", async ({ page }) => {
  await home(page);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await sheet(page).getByRole("button", { name: "Tomorrow" }).click();
  await box(page).fill("Pretend tomorrow thing");
  await box(page).press("Enter");
  await expect(sheet(page).getByRole("status")).toHaveText("Added");
  await sheet(page).getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  await page.goto("/inbox");
  await expect(page.getByText("Pretend tomorrow thing")).toBeVisible();
});

test("a half-typed entry is kept: closed, then the page reloaded (as the Mac's auto-update does)", async ({ page }) => {
  await home(page);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.keyboard.type("Pretend half a thought");
  await sheet(page).getByRole("button", { name: "Tomorrow" }).click();
  await sheet(page).getByRole("button", { name: "Close" }).click();
  await expect(sheet(page)).toHaveCount(0);
  // Switching apps: the page hidden and shown again.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.reload();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(box(page)).toHaveValue("Pretend half a thought");
  await expect(sheet(page).getByRole("button", { name: "Tomorrow" })).toHaveAttribute("aria-pressed", "true");
});

test("More options opens the full Add form with what was typed", async ({ page }) => {
  await home(page);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.keyboard.type("Pretend a bigger plan");
  await sheet(page).getByRole("button", { name: "More options" }).click();
  const title = sheet(page).getByRole("textbox", { name: "Title" });
  await expect(title).toHaveValue("Pretend a bigger plan");
  await expect(title).toBeFocused();
  await sheet(page).getByRole("button", { name: "Add item" }).click();
  await expect(sheet(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(box(page)).toHaveValue("");
});

test("/add opens straight into the quick box (the home-screen bookmark); closing goes Home", async ({ page }) => {
  await page.goto("/add");
  await expect(box(page)).toBeVisible();
  await expect(box(page)).toBeFocused();
  // Saved to the home screen from here, the icon opens /add.
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest-add.webmanifest");
  const manifest = await (await page.request.get("/manifest-add.webmanifest")).json();
  expect(manifest.start_url).toBe("/add");
  await page.keyboard.type("Pretend from the bookmark");
  await page.keyboard.press("Enter");
  await expect(sheet(page).getByRole("status")).toHaveText("Added");
  await sheet(page).getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
});

test("the quick sheet fits: no sideways scroll, fields 16px or more (no iOS zoom)", async ({ page }) => {
  await home(page);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await sheet(page).getByRole("button", { name: "Time" }).click();
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.w);
  const sizes = await sheet(page).locator("input").evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  expect(sizes.length).toBe(2);
  for (const s of sizes) expect(s).toBeGreaterThanOrEqual(16);
});

test.describe("on a computer (Esme: \"do what's best\", 2026-11-17)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("the + opens the same quick box, focused at once; Return saves; Escape closes and keeps the draft", async ({ page }) => {
    await home(page);
    const add = page.getByRole("button", { name: "Add", exact: true });
    await add.click();
    await expect(box(page)).toBeFocused();
    await expect(sheet(page)).toHaveClass(/add-pop/);
    await page.keyboard.type("Pretend desk errand");
    await page.keyboard.press("Enter");
    await expect(sheet(page).getByRole("status")).toHaveText("Added");
    await expect(box(page)).toBeFocused();
    await page.keyboard.type("Pretend half typed on the Mac");
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    await expect(add).toBeFocused();
    await page.reload();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(box(page)).toHaveValue("Pretend half typed on the Mac");
    await page.goto("/inbox");
    await expect(page.getByText("Pretend desk errand")).toBeVisible();
  });

  test("More options opens the full form; + Add a book still opens the full form, pre-set", async ({ page }) => {
    await page.goto("/area/art");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await sheet(page).getByRole("button", { name: "More options" }).click();
    await expect(sheet(page).getByLabel("Title")).toBeFocused();
    await expect(sheet(page).getByLabel("Area")).toHaveValue("art");
    await page.keyboard.press("Escape");
    await page.goto("/area/mind");
    await page.getByRole("button", { name: "+ Add a book" }).click();
    await expect(sheet(page).getByLabel("Type")).toHaveValue("book");
    await expect(sheet(page).getByRole("textbox", { name: "What's on your mind?" })).toHaveCount(0);
  });
});
