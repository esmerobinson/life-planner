import { expect, test } from "@playwright/test";

test("approved soft-pill control styles in real Chrome", async ({ page }) => {
  await page.goto("/");
  const add = page.getByRole("button", { name: "Add", exact: true });
  const a = await add.evaluate((el) => {
    const s = getComputedStyle(el);
    return { r: parseFloat(s.borderTopLeftRadius), h: el.getBoundingClientRect().height, bg: s.backgroundColor };
  });
  expect(a.r).toBeGreaterThanOrEqual(a.h / 2);
  expect(a.bg).toBe("rgb(152, 194, 147)");

  const inbox = page.getByRole("link", { name: "Inbox" }).first();
  expect(await inbox.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(212, 209, 195)");

  await add.click();
  const input = page.getByLabel("Title");
  const i = await input.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, r: s.borderTopLeftRadius };
  });
  expect(i).toEqual({ bg: "rgb(227, 221, 205)", r: "12px" });

  // Keyboard focus ring is the magenta placeholder.
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  for (let n = 0; n < 40; n++) {
    await page.keyboard.press("Tab");
    if (await add.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(add).toBeFocused();
  const ring = await add.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.outlineColor, style: s.outlineStyle };
  });
  expect(ring.color).toBe("rgb(255, 0, 255)");
  expect(ring.style).not.toBe("none");
});

test("sidebar stays pinned after scrolling", async ({ page }) => {
  await page.goto("/");
  await page.addStyleTag({ content: "main.app-content::after{content:'';display:block;height:3000px}" });
  await page.evaluate(() => window.scrollTo(0, 800));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const nav = page.getByRole("navigation", { name: "Main" });
  expect(await nav.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
  expect(await nav.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(0);
});
