import { expect, test, type Page } from "@playwright/test";

/* Reminders (4A, a simple list) in a real browser. All data is fictional. The Mac app's bridge
   is pretended with an init script that records every schedule the page sends. */

// A Wednesday, 7am local: every reminder of the day is still ahead.
const NOW = new Date(2026, 10, 4, 7, 0);
const TODAY = "2026-11-04";

type Sent = { id: string; at: string; title: string; body: string; path: string }[];

async function pretendMac(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const sent: unknown[] = [];
    w.__sent = sent;
    w.webkit = {
      messageHandlers: {
        esmeworldReminders: {
          postMessage: async (m: { action: string; reminders?: unknown[] }) => {
            if (m.action === "schedule") sent.push(m.reminders);
            return { status: "authorized", scheduled: m.reminders?.length ?? 0, pending: m.reminders?.length ?? 0 };
          },
        },
      },
    };
  });
}

const lastSent = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __sent: Sent[] }).__sent;
    return s.length ? s[s.length - 1] : null;
  });

async function seedTodo(page: Page, title: string) {
  await page.evaluate(
    async ([t, today]) => {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open("life-hub");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(["items"], "readwrite");
        tx.objectStore("items").put({
          id: "r1", kind: "task", title: t, links: [], areaId: "admin", priority: 2, status: "open",
          pinnedDate: today, createdAt: today, touchedAt: today,
        });
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    },
    [title, TODAY] as const,
  );
}

test.describe("Reminders", () => {
  test("the footer link opens the list; changes stay on this device; a browser tab says the Mac app shows them", async ({ page }) => {
    await page.goto("/");
    await page.locator(".sidebar-footer").getByRole("link", { name: "Reminders" }).click();
    await expect(page.getByRole("heading", { name: "Reminders" })).toBeVisible();
    await expect(page.locator(".rem-row")).toHaveCount(6);
    await expect(page.getByText(/pop up from the Esmeworld Mac app/)).toBeVisible();

    await page.getByRole("button", { name: "Monthly review: Off" }).click();
    await page.getByLabel("Morning pages time").fill("07:15");
    await expect(page.getByRole("button", { name: "Monthly review: On" })).toBeVisible();
    // Saved on this device (syncMeta) before reloading.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const db: IDBDatabase = await new Promise((res, rej) => {
            const r = indexedDB.open("life-hub");
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
          });
          const row = await new Promise<{ value?: { monthly?: { on?: boolean }; morning?: { time?: string } } } | undefined>((res, rej) => {
            const g = db.transaction("syncMeta").objectStore("syncMeta").get("reminders");
            g.onsuccess = () => res(g.result);
            g.onerror = () => rej(g.error);
          });
          db.close();
          return `${row?.value?.monthly?.on} ${row?.value?.morning?.time}`;
        }),
      )
      .toBe("true 07:15");
    await page.reload();
    await expect(page.getByRole("button", { name: "Monthly review: On" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Morning pages time")).toHaveValue("07:15");
  });

  test("in the Mac app, the schedule follows the data: a ticked to-do drops out", async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await pretendMac(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Today" }).first()).toBeVisible();
    await seedTodo(page, "Pretend errand");
    await page.reload();

    await expect.poll(async () => (await lastSent(page))?.find((r) => r.id === `todos:${TODAY}`)).toEqual({
      id: `todos:${TODAY}`, at: `${TODAY}T09:00`, title: "1 to-do today", body: "Pretend errand", path: "/today",
    });
    const first = (await lastSent(page))!;
    expect(first[0]).toMatchObject({ id: `morning:${TODAY}`, at: `${TODAY}T08:30`, path: "/journal/morning" });

    // Tick it on Today (an in-app move, so the recorder keeps its list).
    await page.locator(".sidebar").getByRole("link", { name: "Today" }).click();
    await page.getByRole("checkbox", { name: "Mark done: Pretend errand" }).click();
    await expect
      .poll(async () => (await lastSent(page))?.some((r) => r.id === `todos:${TODAY}`), { timeout: 10_000 })
      .toBe(false);
  });

  test("in the Mac app, the page speaks of this Mac", async ({ page }) => {
    await pretendMac(page);
    await page.goto("/reminders");
    await expect(page.getByText(/pops up a notification on this Mac/)).toBeVisible();
    await expect(page.getByText(/the Mac asks once/)).toBeVisible();
  });

  test("on the phone: the same list, and a note that phone reminders come with the iPhone app", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/reminders");
    await expect(page.locator(".rem-row")).toHaveCount(6);
    await expect(page.getByText(/Reminders on the phone come with the iPhone app/)).toBeVisible();
    // The time moves under the name.
    const row = page.locator(".rem-row").first();
    const name = await row.locator(".rem-name").boundingBox();
    const time = await row.getByLabel("Morning pages time").boundingBox();
    expect(time!.y).toBeGreaterThan(name!.y);
  });
});
