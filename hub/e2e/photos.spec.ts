import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* Photos on to-do and idea pages and on "What I did" notes (Esme, 19 Nov 2026: "add option to
   add photos to ideas and to dos notes"), in a real browser at the Mac's width and the phone's:
   the Photo button opens the picker (image/*, several, no `capture`, so the iPhone offers Take
   Photo or Photo Library), the photo is downscaled by the real canvas and stored in the files
   table, shows, and survives a reload; the card after a tick and the side panel have Add photo;
   the log page shows it and tapping it shows it larger. On the Mac width also paste and drop.
   Every image is generated here; all data is fictional. Set SHOTS_DIR for screenshots. */

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

/** A made-up landscape as PNG bytes, drawn by the browser's canvas. */
async function makePng(page: Page, width = 2400, height = 1600): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ([w, h]) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#b9d3ee";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#8fb27a";
      ctx.fillRect(0, h * 0.65, w, h * 0.35);
      ctx.fillStyle = "#f6d36b";
      ctx.beginPath();
      ctx.arc(w * 0.75, h * 0.25, h * 0.09, 0, Math.PI * 2);
      ctx.fill();
      const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    },
    [width, height] as const,
  );
  return Buffer.from(b64, "base64");
}

/** Clicks a button that opens the photo picker and chooses one generated photo. */
async function pickPhoto(page: Page, click: () => Promise<void>, name = "pretend-photo.png") {
  const chooser = page.waitForEvent("filechooser");
  await click();
  const fc = await chooser;
  expect(fc.isMultiple()).toBe(true);
  const input = fc.element();
  expect(await input.getAttribute("accept")).toBe("image/*");
  expect(await input.getAttribute("capture")).toBeNull();
  await fc.setFiles({ name, mimeType: "image/png", buffer: await makePng(page) });
}

async function seed(page: Page, rows: unknown[]) {
  await page.evaluate(async (list) => {
    const { db } = await import(/* @vite-ignore */ "/src/data/db.ts" as string);
    await db.items.bulkPut(list);
  }, rows);
}

const readItem = (page: Page, id: string) =>
  page.evaluate(async (i) => {
    const { db } = await import(/* @vite-ignore */ "/src/data/db.ts" as string);
    return db.items.get(i);
  }, id);

const readFile = (page: Page, id: string) =>
  page.evaluate(async (i) => {
    const { db } = await import(/* @vite-ignore */ "/src/data/db.ts" as string);
    return db.files.get(i);
  }, id);

const row = (id: string, day: string, extra: Record<string, unknown> = {}) => ({
  id, kind: "task", title: `Pretend ${id}`, links: [], areaId: "art", priority: 2, status: "open",
  createdAt: day, touchedAt: day, ...extra,
});

const PIC_LINE = /!\[\]\(file:([0-9a-f-]{36})\)/;

async function noSidewaysScroll(page: Page) {
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(m.s).toBeLessThanOrEqual(m.w);
}

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const kind of ["task", "idea"] as const) {
      test(`a photo on ${kind === "task" ? "a to-do" : "an idea"}'s page: the Photo button, downscaled, stored, shown, kept after a reload`, async ({ page }) => {
        await page.goto("/");
        const day = await pageDate(page);
        await seed(page, [row("mural", day, { kind, notes: "Pretend wall sketch" })]);
        await page.goto("/area/art?open=mural");
        const peek = page.locator(".peek");
        await expect(peek.getByRole("button", { name: "Photo" })).toBeVisible();
        await pickPhoto(page, () => peek.getByRole("button", { name: "Photo" }).click());
        await expect(peek.locator(".page-pic img")).toBeVisible();
        await expect.poll(async () => (await readItem(page, "mural")).notes).toMatch(new RegExp(`^Pretend wall sketch\\n${PIC_LINE.source}$`));
        const id = PIC_LINE.exec((await readItem(page, "mural")).notes)![1]!;
        const f = await readFile(page, id);
        expect(f.mime).toBe("image/jpeg");
        expect([f.width, f.height]).toEqual([1600, 1067]); // the real canvas downscaled it
        await noSidewaysScroll(page);
        await shoot(page, `photos-${kind}-page-${width}`);

        await page.reload();
        await expect(page.locator(".peek .page-pic img")).toBeVisible();
        expect(await page.locator(".peek .page-pic img").getAttribute("src")).toMatch(/^data:image\/jpeg;base64,/);
      });
    }

    test("the What did you do? card has Add photo; the photo shows in the side panel and the log, larger when tapped, and survives a reload", async ({ page }) => {
      await page.goto("/");
      const day = await pageDate(page);
      await seed(page, [row("zine", day)]);
      await page.goto("/area/art");
      await page.getByRole("checkbox", { name: "Mark done: Pretend zine" }).click();
      const sheet = page.getByRole("dialog", { name: "What did you do?" });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Add photo" })).toBeVisible();
      await sheet.getByRole("textbox").pressSequentially("Pretend folded twelve copies", { delay: 5 });
      await pickPhoto(page, () => sheet.getByRole("button", { name: "Add photo" }).click());
      await expect(sheet.getByRole("img", { name: "Photo 1" })).toBeVisible();
      await noSidewaysScroll(page);
      await shoot(page, `photos-card-${width}`);
      await sheet.getByRole("button", { name: "Save" }).click();
      await expect(sheet).toHaveCount(0);
      await expect.poll(async () => (await readItem(page, "zine")).didPhotos?.[0]?.ids?.length).toBe(1);
      expect((await readItem(page, "zine")).did[0].note).toBe("Pretend folded twelve copies");

      await page.goto("/area/art?open=zine");
      const panel = page.getByRole("region", { name: "What I did" });
      const thumb = panel.getByRole("button", { name: "Photo 1: show it larger" });
      await expect(thumb.locator("img")).toBeVisible();
      await thumb.click();
      const viewer = page.getByRole("dialog", { name: "Photo" });
      await expect(viewer.getByRole("img")).toBeVisible();
      await shoot(page, `photos-viewer-${width}`);
      await page.keyboard.press("Escape");
      await expect(viewer).toHaveCount(0);
      await expect(panel).toBeVisible(); // Escape closed the photo, not the panel

      await page.goto("/what-i-did");
      const entry = page.locator(".did-entry", { hasText: "Pretend folded twelve copies" });
      await expect(entry.getByRole("button", { name: "Photo 1: show it larger" }).locator("img")).toBeVisible();
      await page.reload();
      await expect(entry.getByRole("button", { name: "Photo 1: show it larger" }).locator("img")).toBeVisible();
      await noSidewaysScroll(page);
      await shoot(page, `photos-log-${width}`);

      // Remove photo in the side panel takes it off the note.
      await page.goto("/area/art?open=zine");
      await page.getByRole("region", { name: "What I did" }).getByRole("button", { name: "Remove photo 1" }).click();
      await expect.poll(async () => (await readItem(page, "zine")).didPhotos).toBeUndefined();
    });
  });
}

test.describe("on the Mac's width: paste and drop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("a photo pasted into a line goes in at the cursor; one dropped on the page goes in after the line", async ({ page }) => {
    await page.goto("/");
    const day = await pageDate(page);
    await seed(page, [row("poster", day, { notes: "left right\nlast line" })]);
    await page.goto("/area/art?open=poster");
    const peek = page.locator(".peek");
    await peek.getByText("left right").click();
    const box = peek.getByRole("textbox", { name: /text 1/ });
    await box.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(4, 4));
    const png = (await makePng(page, 800, 600)).toString("base64");
    await box.evaluate((el, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, png);
    await expect.poll(async () => (await readItem(page, "poster")).notes).toMatch(new RegExp(`^left\\n${PIC_LINE.source}\\nright\\nlast line$`));

    await peek.getByText("last line").evaluate((el, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
      el.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, png);
    await expect.poll(async () => (await readItem(page, "poster")).notes).toMatch(new RegExp(`\\nlast line\\n${PIC_LINE.source}$`));
    await expect(peek.locator(".page-pic img")).toHaveCount(2);
  });
});
