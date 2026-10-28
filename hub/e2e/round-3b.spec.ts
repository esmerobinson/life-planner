import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* Round 3b in a real browser: the page (Notion-like notes) in the task panel: headings,
   checklists ticked in place, links, pictures (downscaled for real by the browser's canvas),
   and the placeholder for a picture that has not synced yet. All data is fictional.
   Set SHOTS_DIR to save screenshots. */

type Row = Record<string, unknown>;

async function seed(page: Page, items: Row[]) {
  await page.evaluate(async (is) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open("life-hub");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(["items"], "readwrite");
      for (const r of is) tx.objectStore("items").put(r);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, items);
}

async function stored(page: Page, store: "items" | "files"): Promise<Row[]> {
  return page.evaluate(async (name) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open("life-hub");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rows = await new Promise<Row[]>((res, rej) => {
      const q = db.transaction([name], "readonly").objectStore(name).getAll();
      q.onsuccess = () => res(q.result as Row[]);
      q.onerror = () => rej(q.error);
    });
    db.close();
    return rows;
  }, store);
}

/**
 * Chooses a generated picture with the page's Picture input: "scene" is a made-up landscape;
 * "noise" is random pixels (barely compressible), so the size rule has to work hard.
 */
async function choosePicture(page: Page, kind: "scene" | "noise", width: number, height: number) {
  await page.evaluate(
    async ([k, w, h]) => {
      const canvas = document.createElement("canvas");
      canvas.width = w as number;
      canvas.height = h as number;
      const ctx = canvas.getContext("2d")!;
      if (k === "noise") {
        const img = ctx.createImageData(canvas.width, canvas.height);
        for (let i = 0; i < img.data.length; i++) img.data[i] = (Math.random() * 256) | 0;
        ctx.putImageData(img, 0, 0);
      } else {
        const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
        sky.addColorStop(0, "#b9d3ee");
        sky.addColorStop(1, "#f3e4c8");
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#8fb27a";
        ctx.beginPath();
        ctx.moveTo(0, canvas.height * 0.7);
        ctx.quadraticCurveTo(canvas.width * 0.35, canvas.height * 0.45, canvas.width, canvas.height * 0.68);
        ctx.lineTo(canvas.width, canvas.height);
        ctx.lineTo(0, canvas.height);
        ctx.fill();
        ctx.fillStyle = "#f6d36b";
        ctx.beginPath();
        ctx.arc(canvas.width * 0.75, canvas.height * 0.25, canvas.height * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
      const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Choose a picture"]')!;
      const dt = new DataTransfer();
      dt.items.add(new File([blob], `${k}.png`, { type: "image/png" }));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [kind, width, height] as const,
  );
}

async function seedTask(page: Page, notes?: string) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const today = await pageDate(page);
  await seed(page, [
    {
      id: "t1", kind: "task", title: "Plan the pretend biography chapter", links: [], areaId: "writing", priority: 2,
      status: "open", createdAt: today, touchedAt: today, ...(notes === undefined ? {} : { notes }),
    },
  ]);
}

const notesOf = async (page: Page) => (await stored(page, "items")).find((r) => r.id === "t1")!.notes;

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

/** Builds the screenshot page by typing, with the add-buttons, and with a real picture. */
async function buildPage(page: Page) {
  const peek = page.locator(".peek");
  await peek.getByText("Start typing…", { exact: false }).click();
  await page.keyboard.type("# What I know so far");
  await page.keyboard.press("Enter");
  await page.keyboard.type("He mentioned the pretend flat. Check the made-up letters box first.");
  await peek.getByRole("button", { name: "Checklist" }).click();
  await page.keyboard.type("Find the pretend letters box");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Write the made-up questions");
  await peek.getByRole("button", { name: "Link" }).click();
  await peek.getByRole("textbox", { name: "Link" }).fill("https://example.com/pretend-research");
  await peek.getByRole("button", { name: "Add link" }).click();
  await choosePicture(page, "scene", 2400, 1600);
  await expect(peek.locator(".page-pic img")).toBeVisible();
  await peek.getByRole("checkbox", { name: "Done: Find the pretend letters box" }).check();
  await page.mouse.click(5, 5); // away from the page: shown formatted
}

test.describe("at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("a task's page: typed heading, checklist ticked in place, link, picture; saved as Markdown", async ({ page }) => {
    await seedTask(page);
    await page.goto("/area/writing?open=t1");
    await buildPage(page);
    const peek = page.locator(".peek");
    await expect(peek.getByRole("heading", { name: "What I know so far" })).toBeVisible();
    await expect(peek.getByRole("link", { name: "https://example.com/pretend-research" })).toHaveAttribute("target", "_blank");
    const img = peek.locator(".page-pic img");
    expect(await img.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("9px");
    expect((await img.boundingBox())!.width).toBeLessThanOrEqual((await peek.locator(".page-lines").boundingBox())!.width);

    await expect
      .poll(() => notesOf(page), { timeout: 5000 })
      .toMatch(
        /^# What I know so far\nHe mentioned the pretend flat\. Check the made-up letters box first\.\n- \[x\] Find the pretend letters box\n- \[ \] Write the made-up questions\nhttps:\/\/example\.com\/pretend-research\n!\[\]\(file:[0-9a-f-]{36}\)$/,
      );
    const [file] = await stored(page, "files");
    expect(file).toMatchObject({ mime: "image/jpeg", width: 1600, height: 1067 });
    await shoot(page, "desktop-1280-task-page");

    // It comes back the same after a reload (from IndexedDB).
    await page.reload();
    await expect(page.locator(".peek .page-pic img")).toBeVisible();
    await expect(page.locator(".peek").getByRole("checkbox", { name: "Done: Find the pretend letters box" })).toBeChecked();
  });

  test("a very large, noisy picture is downscaled under 700 KB by the browser", async ({ page }) => {
    await seedTask(page, "Noise test");
    await page.goto("/area/writing?open=t1");
    await choosePicture(page, "noise", 3200, 2400);
    await expect(page.locator(".peek .page-pic img")).toBeVisible({ timeout: 20_000 });
    const [file] = await stored(page, "files");
    const bytes = Math.floor(((file!.data as string).length * 3) / 4);
    expect(file!.mime).toBe("image/jpeg");
    expect(bytes).toBeLessThan(700_000);
    expect(Math.max(file!.width as number, file!.height as number)).toBeLessThanOrEqual(1600);
    expect((file!.width as number) / (file!.height as number)).toBeCloseTo(4 / 3, 1);
    await expect.poll(() => notesOf(page)).toMatch(/^Noise test\n!\[\]\(file:/);
  });

  test("older notes are untouched by opening, clicking and closing; a missing picture waits in magenta", async ({ page }) => {
    const notes = "Check: not sure if this is still open\nDone when: It runs on my own pretend machine\n![](file:not-here-yet)";
    await seedTask(page, notes);
    await page.goto("/area/writing?open=t1");
    const peek = page.locator(".peek");
    await peek.getByText("Check: not sure if this is still open").click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(peek).toHaveCount(0);
    await page.goto("/area/writing?open=t1");
    const wait = page.locator(".peek").getByRole("img", { name: "Picture on its way" });
    await expect(wait).toBeVisible();
    expect(await wait.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 0, 255)");
    expect(await notesOf(page)).toBe(notes);
  });

  test("the / menu turns a line into a checklist item", async ({ page }) => {
    await seedTask(page);
    await page.goto("/area/writing?open=t1");
    await page.locator(".peek").getByText("Start typing…", { exact: false }).click();
    await page.keyboard.type("/che");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Ring the pretend archive");
    await expect.poll(() => notesOf(page), { timeout: 5000 }).toBe("- [ ] Ring the pretend archive");
  });
});

test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the page fits the phone and does not scroll sideways", async ({ page }) => {
    await seedTask(page);
    await page.goto("/area/writing?open=t1");
    await buildPage(page);
    const m = await page.evaluate(() => {
      const peek = document.querySelector<HTMLElement>(".peek-scroll");
      return {
        scrollWidth: Math.max(document.documentElement.scrollWidth, peek ? peek.scrollWidth + (window.innerWidth - peek.clientWidth) : 0),
        innerWidth: window.innerWidth,
      };
    });
    expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
    await page.locator(".page-pic img").scrollIntoViewIfNeeded();
    await page.locator(".peek").getByRole("heading", { name: "What I know so far" }).scrollIntoViewIfNeeded();
    await shoot(page, "phone-390-task-page");
  });
});
