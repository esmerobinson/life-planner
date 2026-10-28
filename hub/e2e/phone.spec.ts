import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* The phone layout (VISUAL-LANGUAGE.md "Phone layout", option A) in a real browser, and
   the rule that nothing scrolls sideways at 360-430px on any page. All data is fictional.
   Set SHOTS_DIR to also save a 390px screenshot of every route (and desktop Home). */

type Row = Record<string, unknown>;

/** Raw rows into IndexedDB (a fresh context per test, so nothing real is touched). */
async function seed(page: Page, items: Row[], goals: Row[]) {
  await page.evaluate(
    async ([is, gs]) => {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open("life-hub");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      // A wide made-up picture for the task page (round 3b), drawn here so it is a real JPEG.
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 400;
      canvas.getContext("2d")!.fillRect(0, 0, 1600, 400);
      const data = canvas.toDataURL("image/jpeg", 0.8).split(",")[1]!;
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(["items", "goals", "files"], "readwrite");
        for (const r of is) tx.objectStore("items").put(r);
        for (const g of gs) tx.objectStore("goals").put(g);
        tx.objectStore("files").put({ id: "ph1", mime: "image/jpeg", data, width: 1600, height: 400, createdAt: "2026-10-28" });
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    },
    [items, goals] as const,
  );
}

/** A small pretend world with long titles, so wrapping is exercised on every page. */
async function seedPretendWorld(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const d = (n: number) => pageDate(page, n);
  const today = await d(0);
  const thisMonth = today.slice(0, 8);
  const task = (id: string, title: string, extra: Row = {}): Row => ({
    id, kind: "task", title, links: [], areaId: "art", priority: 3, status: "open",
    createdAt: today, touchedAt: today, ...extra,
  });
  const items: Row[] = [
    task("t1", "Sketch the pretend lighthouse for the zine cover", { due: await d(-2), priority: 1, goalId: "g1" }),
    task("t2", "Sort the imaginary paint drawer by colour family, then label every jar so it is easy to find later", {
      due: today,
      // The page (round 3b): a heading, a checklist, an unbroken long link, a wide picture.
      notes: [
        "# Pretend drawer plan",
        "- [x] Empty the pretend drawer onto the table",
        "- [ ] Group the made-up jars by colour family and write a label for every single one",
        "https://example.com/a/very/long/pretend/link/without/any/spaces/that/must/still/wrap/inside/the/phone/width",
        "![](file:ph1)",
      ].join("\n"),
    }),
    task("t3", "Supercalifragilisticexpialidociouspretendwordwithnobreaks", { pinnedDate: today, areaId: "writing" }),
    task("t4", "Book the pretend life-drawing class", { due: await d(3), areaId: "admin" }),
    { ...task("i1", "A comic about a snail who runs a pretend post office"), kind: "idea", notes: "Maybe four panels" },
    task("d1", "Ink the fictional map", { status: "done", completedAt: `${thisMonth}01`, goalId: "g1" }),
    task("x1", "Pretend loose thought to file somewhere sensible eventually", { areaId: "inbox", priority: 2 }),
    { ...task("x2", "Pretend idea to sort later", { areaId: "inbox", priority: 2 }), kind: "idea" },
    task("h1", "Pretend daily sketch: one small drawing of anything nearby", {
      recur: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], doneDates: [today],
    }),
    task("h2", "Pretend scales practice", { recur: ["mon", "wed", "fri"] }),
  ];
  const goals: Row[] = [
    { id: "g1", title: "Draw every week, even the pretend weeks with long names", areaId: "art", kind: "practice", monthlyTarget: 4, milestones: [], createdAt: today },
    {
      id: "g2", title: "Finish the pretend essay collection", areaId: "writing", kind: "finite", deadline: `${today.slice(0, 4)}-12-31`,
      monthlyTarget: 6, createdAt: today,
      milestones: [
        { id: "m1", title: "Outline", done: true },
        { id: "m2", title: "First draft", done: false },
      ],
    },
  ];
  await seed(page, items, goals);
}

/** Every route. */
const ROUTES = [
  ["home", "/"],
  ["today", "/today"],
  ["goals", "/goals"],
  ["goal-panel", "/goals?open=g2"],
  ["task-panel", "/area/art?open=t2"],
  ["inbox-panel", "/inbox?open=x1"],
  ["admin", "/area/admin"],
  ["writing", "/area/writing"],
  ["art", "/area/art"],
  ["content", "/area/content"],
  ["mind", "/area/mind"],
  ["body", "/area/body"],
  ["tech", "/area/tech"],
  ["production", "/area/production"],
  ["journal", "/journal"],
  ["vision", "/vision"],
  ["inbox", "/inbox"],
  ["inbox-sort", "/inbox/sort"],
  ["bin", "/bin"],
  ["backup", "/backup"],
  ["sync", "/sync"],
] as const;

/** The page's width, or the open side panel's (it scrolls on its own, over the page). */
async function sideways(page: Page) {
  return page.evaluate(() => {
    const peek = document.querySelector<HTMLElement>(".peek-scroll");
    return {
      scrollWidth: Math.max(document.documentElement.scrollWidth, peek ? peek.scrollWidth + (window.innerWidth - peek.clientWidth) : 0),
      innerWidth: window.innerWidth,
    };
  });
}

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

for (const width of [360, 390, 430]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });

    for (const [name, path] of ROUTES) {
      test(`${name} does not scroll sideways`, async ({ page }) => {
        await seedPretendWorld(page);
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await expect(page.locator(".phone-top")).toBeVisible();
        await page.waitForLoadState("networkidle");
        const m = await sideways(page);
        expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
        if (width === 390) await shoot(page, `phone-390-${name}`);
      });
    }

    test("open menus and the Add form do not scroll sideways", async ({ page }) => {
      await seedPretendWorld(page);
      await page.goto("/today");
      await page.getByRole("button", { name: "Add" }).click();
      await page.getByRole("button", { name: /^Schedule for: Sort the imaginary/ }).click();
      let m = await sideways(page);
      expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Move to: Sort the imaginary/ }).click();
      m = await sideways(page);
      expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
      if (width === 390) await shoot(page, "phone-390-today-add-and-menu");
    });
  });
}

test.describe("phone layout at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Home: no sidebar, Esmeworld and the Inbox pill, the app grid, Today, then Backup, Sync and Bin", async ({ page }) => {
    await seedPretendWorld(page);
    await page.reload();
    await expect(page.locator("aside.sidebar")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Esmeworld" })).toBeVisible();
    await expect(page.locator(".phone-top").getByRole("link", { name: /^Inbox \(\d+\)$/ })).toBeVisible();
    const apps = page.getByRole("navigation", { name: "Main" }).getByRole("link");
    await expect(apps).toHaveCount(12);
    const tile = await apps.first().locator(".phone-app-tile").boundingBox();
    expect(tile?.width).toBe(62);
    expect(tile?.height).toBe(62);
    await expect(page.getByRole("heading", { level: 2, name: "Today" })).toBeVisible();
    await expect(page.getByText("Sort the imaginary paint drawer", { exact: false })).toBeVisible();
    const more = page.getByRole("navigation", { name: "More" });
    await expect(more.getByRole("link", { name: "Backup" })).toBeVisible();
    await expect(more.getByRole("link", { name: "Sync" })).toBeVisible();
    await expect(more.getByRole("link", { name: "Bin" })).toBeVisible();
  });

  test("an app opens full-screen with a back arrow that returns Home; opened directly, Back goes Home", async ({ page }) => {
    await seedPretendWorld(page);
    await page.reload();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Art" }).click();
    await expect(page).toHaveURL(/\/area\/art$/);
    await expect(page.locator(".phone-title")).toHaveText("Art");
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Esmeworld" })).toBeVisible();

    await page.goto("/goals");
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("fields are at least 16px (no iOS zoom on focus) on Sync, Goals and the Add form", async ({ page }) => {
    for (const path of ["/sync", "/goals", "/today"]) {
      await page.goto(path);
      if (path === "/today") await page.getByRole("button", { name: "Add" }).click();
      const fields = page.locator(".app-content").locator("input:not([type=checkbox]):not([type=file]), textarea, select");
      expect(await fields.count()).toBeGreaterThan(0);
      const sizes = await fields.evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
      for (const s of sizes) expect(s, path).toBeGreaterThanOrEqual(16);
    }
  });

  test("Back looks 34px but takes a tap 3px outside it (a 40px target)", async ({ page }) => {
    await page.goto("/goals");
    const back = page.getByRole("button", { name: "Back" });
    const box = (await back.boundingBox())!;
    expect(box.width).toBe(34);
    expect(box.height).toBe(34);
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label"), [
      box.x + box.width + 2.5, box.y + box.height / 2, // the target is a 40px circle
    ]);
    expect(hit).toBe("Back");
    await page.mouse.click(box.x - 2.5, box.y + box.height / 2);
    await expect(page).toHaveURL(/\/$/);
  });

  test("an opened goal fills the screen, fits, and its Back returns to Goals", async ({ page }) => {
    await seedPretendWorld(page);
    await page.goto("/goals");
    await page.getByRole("link", { name: /^Draw every week/ }).click();
    await expect(page).toHaveURL(/\/goals\?open=g1$/);
    const peek = page.locator(".peek");
    await expect(peek.getByRole("heading", { level: 2, name: /^Draw every week/ })).toBeVisible();
    const box = (await peek.boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(390);
    await expect(peek.getByRole("button", { name: "Close" })).toHaveCount(0);
    await expect(peek.getByRole("separator")).toHaveCount(0);
    const m = await sideways(page);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
    await peek.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/goals$/);
    await expect(page.locator(".peek")).toHaveCount(0);
  });

  test("tapping a task opens it full screen; its Back returns to the list", async ({ page }) => {
    await seedPretendWorld(page);
    await page.goto("/area/art");
    await page.getByRole("button", { name: /^Sort the imaginary paint drawer/ }).click();
    const peek = page.locator(".peek");
    await expect(peek.getByLabel("Title")).toHaveValue(/^Sort the imaginary paint drawer/);
    await shoot(page, "phone-390-task-panel-open");
    await peek.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/area\/art$/);
  });
});

test.describe("desktop at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Home keeps the sidebar and its own layout", async ({ page }) => {
    await seedPretendWorld(page);
    await page.reload();
    await expect(page.locator("aside.sidebar")).toBeVisible();
    await expect(page.locator(".phone-top")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Goals this month" })).toBeVisible();
    await shoot(page, "desktop-1280-home");
  });
});
